import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createSubjectService } from "@lotse/brain/subjects";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { documents, facts, users } from "@lotse/db/schema";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const environmentPath = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);

describe("WP-190 subject service against real Postgres", () => {
  const admin = createDatabase();
  const databaseName = `lotse_subjects_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(admin.config.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
  let created = false;

  beforeAll(async () => {
    await admin.sql`CREATE DATABASE ${admin.sql(databaseName)}`;
    created = true;
    await migrateDatabase(database);
  });

  afterAll(async () => {
    await database.close();
    try {
      if (created) await admin.sql`DROP DATABASE ${admin.sql(databaseName)}`;
    } finally {
      await admin.close();
    }
  });

  async function fixture(relationToUser = "self") {
    const ownerId = randomUUID();
    const helperId = randomUUID();
    const strangerId = randomUUID();
    await database.db.insert(users).values([{ id: ownerId }, { id: helperId }, { id: strangerId }]);
    const owner = createSubjectService(database, ownerId);
    const helper = createSubjectService(database, helperId);
    const stranger = createSubjectService(database, strangerId);
    const subject = await owner.createSubject({ displayName: "Testperson", relationToUser });
    const result = await owner.createCase({
      subjectId: subject.id,
      confirmedGoal: "Antrag vorbereiten",
    });
    return { ownerId, helperId, strangerId, owner, helper, stranger, subject, ...result };
  }

  // Synthetic administrative facts are test-only; every row is persisted in real Postgres.
  async function seedFacts(subjectId: string): Promise<void> {
    const documentId = randomUUID();
    await database.db.insert(documents).values({
      id: documentId,
      subjectId,
      type: "letter",
      storageKey: `subjects-test/${documentId}`,
      hash: "a".repeat(64),
      originClient: "web",
    });
    await database.db.insert(facts).values(
      ["residence", "insurance"].map((type) => ({
        subjectId,
        type,
        value: "Testangabe",
        documentId,
        source: { kind: "document", quote: "Testangabe" },
        confidence: 1,
        confirmed: true,
      })),
    );
  }

  test("AC1 FR-P7 a helper sees only subject facts in its persisted case share scope", async () => {
    const context = await fixture();
    await seedFacts(context.subject.id);
    const actor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "restricted", factTypes: ["residence"] },
    });

    const visible = await context.helper.factsVisibleTo(actor.id, context.subject.id);

    expect(visible.map((fact) => fact.type)).toEqual(["residence"]);
    expect(visible.every((fact) => fact.subjectId === context.subject.id)).toBe(true);
    expect(await context.owner.factsVisibleTo(context.actor.id, context.subject.id)).toHaveLength(
      2,
    );
    expect(await context.stranger.factsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    const other = await fixture();
    await seedFacts(other.subject.id);
    expect(await context.helper.factsVisibleTo(actor.id, other.subject.id)).toEqual([]);
  });

  test("AC2 stores only a token hash and admits exactly one concurrent invite redemption", async () => {
    const context = await fixture();
    const invite = await context.owner.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "restricted", factTypes: ["residence"] },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [stored] = await database.sql`
      SELECT token_hash FROM helper_invite WHERE case_id = ${context.case.id}`;
    expect(stored?.token_hash === createHash("sha256").update(invite.token).digest("hex")).toBe(
      true,
    );

    const results = await Promise.allSettled([
      context.helper.acceptHelperInvite(invite.token),
      context.stranger.acceptHelperInvite(invite.token),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winner = results.find((result) => result.status === "fulfilled");
    expect(winner?.status === "fulfilled" && winner.value.role).toBe("helper");
    expect(winner?.status === "fulfilled" && winner.value.shareScope).toEqual({
      mode: "restricted",
      factTypes: ["residence"],
    });
    await expect(context.helper.acceptHelperInvite(invite.token)).rejects.toMatchObject({
      code: "invalid_invite",
    });
  });

  test("AC3 FR-P5 subject deletion removes facts, all cases, actors, documents and invites", async () => {
    const context = await fixture("parent");
    await seedFacts(context.subject.id);
    await context.owner.createCase({
      subjectId: context.subject.id,
      confirmedGoal: "Unterlagen sammeln",
    });
    await context.owner.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const other = await fixture();
    await seedFacts(other.subject.id);

    await context.owner.deleteSubject(context.subject.id);

    for (const table of ["subject", "fact", "document", "case"]) {
      const column = table === "subject" ? "id" : "subject_id";
      expect(
        await database.sql`SELECT id FROM ${database.sql(table)} WHERE ${database.sql(column)} = ${context.subject.id}`,
      ).toHaveLength(0);
    }
    for (const table of ["case_actor", "helper_invite"]) {
      expect(
        await database.sql`SELECT id FROM ${database.sql(table)} WHERE case_id = ${context.case.id}`,
      ).toHaveLength(0);
    }
    expect(await other.owner.factsVisibleTo(other.actor.id, other.subject.id)).toHaveLength(2);
    expect(await context.owner.factsVisibleTo(context.actor.id, context.subject.id)).toEqual([]);
  });

  test("AC2 rejects expired, unknown and malformed tokens without admitting an actor", async () => {
    const context = await fixture();
    const invite = await context.owner.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Set persisted times in the past, using the real database clock; no sleeps or clock doubles.
    await database.sql`
      UPDATE helper_invite SET created_at = clock_timestamp() - interval '2 hours',
        expires_at = clock_timestamp() - interval '1 hour' WHERE case_id = ${context.case.id}`;

    for (const token of [invite.token, "0".repeat(64), "invalid"]) {
      await expect(context.helper.acceptHelperInvite(token)).rejects.toMatchObject({
        code: "invalid_invite",
      });
    }

    expect(
      await database.sql`SELECT id FROM case_actor WHERE case_id = ${context.case.id}`,
    ).toHaveLength(1);
    const [row] =
      await database.sql`SELECT consumed_at FROM helper_invite WHERE case_id = ${context.case.id}`;
    expect(row?.consumed_at).toBeNull();
    await expect(
      context.owner.inviteHelper({
        caseId: context.case.id,
        shareScope: { mode: "full" },
        expiresAt: new Date(0),
      }),
    ).rejects.toMatchObject({ code: "invalid_expiry" });
  });

  test("AC2 a failed actor insertion rolls back consumption so another helper can join", async () => {
    const context = await fixture();
    const invite = await context.owner.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(context.owner.acceptHelperInvite(invite.token)).rejects.toMatchObject({
      code: "actor_exists",
    });
    const actor = await context.helper.acceptHelperInvite(invite.token);

    expect(actor.userId).toBe(context.helperId);
    expect(actor.shareScope).toEqual({ mode: "full" });
  });

  test("FR-P7 only the case owner or subject can grant access; helpers cannot elevate or delete", async () => {
    const context = await fixture();
    const actor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "restricted", factTypes: ["residence"] },
    });
    const inviteInput = {
      caseId: context.case.id,
      shareScope: { mode: "full" as const },
      expiresAt: new Date(Date.now() + 60_000),
    };

    await expect(context.helper.inviteHelper(inviteInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(context.stranger.inviteHelper(inviteInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      context.helper.addCaseActor({
        caseId: context.case.id,
        userId: context.strangerId,
        role: "subject",
        shareScope: { mode: "full" },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(context.helper.deleteSubject(context.subject.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      context.stranger.createCase({
        subjectId: context.subject.id,
        confirmedGoal: "Unterlagen sammeln",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      context.owner.addCaseActor({
        caseId: context.case.id,
        userId: context.helperId,
        role: "subject",
        shareScope: { mode: "full" },
      }),
    ).rejects.toMatchObject({ code: "actor_exists" });
    await seedFacts(context.subject.id);
    expect(
      (await context.helper.factsVisibleTo(actor.id, context.subject.id)).map((fact) => fact.type),
    ).toEqual(["residence"]);
  });

  test("AC1 scopes fail closed and are reloaded per call without merging cases", async () => {
    const context = await fixture();
    await seedFacts(context.subject.id);
    const actor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "restricted", factTypes: [] },
    });
    const other = await context.owner.createCase({
      subjectId: context.subject.id,
      confirmedGoal: "Unterlagen sammeln",
    });
    const otherActor = await context.owner.addCaseActor({
      caseId: other.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "full" },
    });

    expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    expect(await context.helper.factsVisibleTo(otherActor.id, context.subject.id)).toHaveLength(2);
    for (const scope of [{}, { mode: "restricted" }, { mode: "full", unexpected: true }]) {
      await database.sql`UPDATE case_actor SET share_scope = ${JSON.stringify(scope)}::jsonb WHERE id = ${actor.id}`;
      expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    }
    await database.sql`DELETE FROM case_actor WHERE id = ${otherActor.id}`;
    expect(await context.helper.factsVisibleTo(otherActor.id, context.subject.id)).toEqual([]);
  });

  test("FR-P7 a helper can start a case for another person and a subject can grant access", async () => {
    const context = await fixture("parent");
    await seedFacts(context.subject.id);
    expect(context.actor.role).toBe("helper");
    expect(context.subject.createdBy).toBe(context.ownerId);
    expect(await context.owner.factsVisibleTo(context.actor.id, context.subject.id)).toHaveLength(
      2,
    );
    const subjectActor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "subject",
      shareScope: { mode: "full" },
    });

    const invite = await context.helper.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "restricted", factTypes: ["insurance"] },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const actor = await context.stranger.acceptHelperInvite(invite.token);

    expect(
      (await context.stranger.factsVisibleTo(actor.id, context.subject.id)).map(
        (fact) => fact.type,
      ),
    ).toEqual(["insurance"]);
    expect(await context.helper.factsVisibleTo(subjectActor.id, context.subject.id)).toHaveLength(
      2,
    );
    await context.helper.deleteSubject(context.subject.id);
    expect(await context.owner.factsVisibleTo(context.actor.id, context.subject.id)).toEqual([]);
  });

  test("FR-P7 revoked subject authority invalidates previously issued invites", async () => {
    const context = await fixture();
    const actor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "subject",
      shareScope: { mode: "full" },
    });
    const invite = await context.helper.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await database.sql`DELETE FROM case_actor WHERE id = ${actor.id}`;

    await expect(context.stranger.acceptHelperInvite(invite.token)).rejects.toMatchObject({
      code: "forbidden",
    });

    expect(
      await database.sql`SELECT id FROM case_actor WHERE case_id = ${context.case.id} AND user_id = ${context.strangerId}`,
    ).toHaveLength(0);
  });
});
