import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import {
  createSubjectService,
  enforceTurnRateLimit,
  SessionRateLimitError,
} from "@lotse/brain/subjects";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { documents, facts, sessions, users } from "@lotse/db/schema";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createApprovalService } from "../../src/approvals/index.ts";
import { resolveContext } from "../../src/conversation/store.ts";
import { buildTools } from "../../src/tools/registry.ts";

const environmentPath = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);

describe("subject service against real Postgres", () => {
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

  test("FR-D4 document viewer resolves case identity without broadening helper scopes", async () => {
    const context = await fixture();
    await seedFacts(context.subject.id);
    expect(await context.owner.documentsVisibleInCase(context.case.id)).toHaveLength(1);
    expect(await context.stranger.documentsVisibleInCase(context.case.id)).toEqual([]);
    const actor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "restricted", factTypes: ["residence"] },
    });
    expect(await context.helper.documentsVisibleInCase(context.case.id)).toEqual([]);
    const [document] = await context.owner.documentsVisibleInCase(context.case.id);
    if (!document) throw new Error("Missing document fixture");
    await database.sql`UPDATE case_actor SET share_scope = ${JSON.stringify({ mode: "restricted", factTypes: [], documentIds: [document.id] })}::jsonb WHERE id = ${actor.id}`;
    expect(
      (await context.helper.documentsVisibleInCase(context.case.id)).map((entry) => entry.id),
    ).toEqual([document.id]);
    await database.sql`UPDATE case_actor SET share_scope = ${JSON.stringify({ mode: "restricted", case: false, factTypes: [], documentIds: [document.id] })}::jsonb WHERE id = ${actor.id}`;
    expect(await context.helper.documentsVisibleInCase(context.case.id)).toEqual([]);
  });

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
  async function helperSession(userId: string): Promise<string> {
    const id = randomUUID();
    await database.db
      .insert(sessions)
      .values({ id, userId, clientKind: "web", expiresAt: new Date(Date.now() + 3600_000) });
    return id;
  }

  test("FR-R1 joining grants no access until the owner approves, then either side can end", async () => {
    const context = await fixture();
    await seedFacts(context.subject.id);
    const sessionId = await helperSession(context.helperId);
    const invite = await context.owner.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const join = await context.helper.requestHelperJoin(invite.token, sessionId);
    expect(join.status).toBe("pending");
    expect(
      await database.sql`SELECT id FROM case_actor WHERE case_id = ${context.case.id} AND user_id = ${context.helperId}`,
    ).toHaveLength(0);
    await expect(context.helper.approveHelperJoin(join.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(context.stranger.approveHelperJoin(join.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    const actor = await context.owner.approveHelperJoin(join.id);
    expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toHaveLength(2);
    expect((await context.owner.listHelperSessions(context.case.id))[0]?.status).toBe("active");
    await expect(context.owner.approveHelperJoin(join.id)).rejects.toMatchObject({
      code: "invalid_invite",
    });
    await context.helper.controlHelperSession({ joinId: join.id, action: "end" });
    expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    expect(await context.owner.listHelperSessions(context.case.id)).toEqual([]);
  });

  test("FR-R5 only the owner can pause or resume; pausing immediately hides facts and documents", async () => {
    const context = await fixture();
    await seedFacts(context.subject.id);
    const sessionId = await helperSession(context.helperId);
    const invite = await context.owner.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const join = await context.helper.requestHelperJoin(invite.token, sessionId);
    const actor = await context.owner.approveHelperJoin(join.id);
    await expect(
      context.helper.controlHelperSession({ joinId: join.id, action: "resume" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await context.owner.controlHelperSession({ joinId: join.id, action: "pause" });
    expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    expect(await context.helper.documentsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    await context.owner.controlHelperSession({ joinId: join.id, action: "resume" });
    expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toHaveLength(2);
    expect(await context.helper.documentsVisibleTo(actor.id, context.subject.id)).toHaveLength(1);
    const otherSession = createSubjectService(
      database,
      context.helperId,
      await helperSession(context.helperId),
    );
    expect(await otherSession.factsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    await context.owner.controlHelperSession({ joinId: join.id, action: "end" });
    expect(await context.helper.documentsVisibleTo(actor.id, context.subject.id)).toEqual([]);
  });

  test("FR-R5 sharing a fact never shares the complete source document; document ids are explicit", async () => {
    const context = await fixture();
    await seedFacts(context.subject.id);
    const actor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "restricted", factTypes: ["residence"] },
    });
    expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toHaveLength(1);
    expect(await context.helper.documentsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    const [document] = await context.owner.documentsVisibleTo(context.actor.id, context.subject.id);
    if (!document) throw new Error("Missing document fixture");
    await database.sql`UPDATE case_actor SET share_scope = ${JSON.stringify({ mode: "restricted", factTypes: [], documentIds: [document.id] })}::jsonb WHERE id = ${actor.id}`;
    expect(
      (await context.helper.documentsVisibleTo(actor.id, context.subject.id)).map(
        (entry) => entry.id,
      ),
    ).toEqual([document.id]);
    expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    expect(await context.stranger.documentsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    await database.sql`UPDATE case_actor SET share_scope = ${JSON.stringify({ mode: "restricted", case: false, factTypes: ["residence"], documentIds: [document.id] })}::jsonb WHERE id = ${actor.id}`;
    expect(await context.helper.documentsVisibleTo(actor.id, context.subject.id)).toEqual([]);
    expect(await context.helper.factsVisibleTo(actor.id, context.subject.id)).toEqual([]);
  });

  test("FR-R1 expired pending joins and revoked issuers cannot be approved", async () => {
    const context = await fixture();
    const sessionId = await helperSession(context.helperId);
    const invite = await context.owner.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const join = await context.helper.requestHelperJoin(invite.token, sessionId);
    await database.sql`UPDATE helper_session SET scope = jsonb_set(scope, '{expiresAt}', to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id = ${join.id}`;
    await expect(context.owner.approveHelperJoin(join.id)).rejects.toMatchObject({
      code: "invalid_invite",
    });
    expect(
      await database.sql`SELECT id FROM case_actor WHERE case_id = ${context.case.id} AND user_id = ${context.helperId}`,
    ).toHaveLength(0);
    await expect(
      context.owner.inviteHelper({
        caseId: context.case.id,
        shareScope: { mode: "full" },
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      }),
    ).rejects.toMatchObject({ code: "invalid_expiry" });
  });

  test("FR-R5 turn counters serialize concurrent requests, remain session-specific and log denials", async () => {
    const context = await fixture();
    const sessionId = await helperSession(context.ownerId);
    const input = {
      userId: context.ownerId,
      sessionId,
      caseId: context.case.id,
      approvalAttempt: false,
    };
    const results = await Promise.allSettled(
      Array.from({ length: 33 }, () => enforceTurnRateLimit(database, input)),
    );
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(30);
    const rejected = results.filter((entry) => entry.status === "rejected");
    expect(rejected).toHaveLength(3);
    for (const entry of rejected)
      if (entry.status === "rejected") expect(entry.reason).toBeInstanceOf(SessionRateLimitError);
    const [denials] =
      await database.sql`SELECT count(*)::int AS count FROM audit_event WHERE action = 'session.rate_limited' AND target->>'sessionId' = ${sessionId}`;
    expect(denials?.count).toBe(3);
    await enforceTurnRateLimit(database, {
      ...input,
      sessionId: await helperSession(context.ownerId),
    });
  });

  test("FR-R5 repeated helper approval attempts have a stricter limit and content-free audit", async () => {
    const context = await fixture();
    await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "full" },
    });
    const sessionId = await helperSession(context.helperId);
    const input = {
      userId: context.helperId,
      sessionId,
      caseId: context.case.id,
      approvalAttempt: true,
    };
    for (let count = 0; count < 5; count++) await enforceTurnRateLimit(database, input);
    await expect(enforceTurnRateLimit(database, input)).rejects.toMatchObject({ status: 429 });
    const attempts =
      await database.sql`SELECT target FROM audit_event WHERE action = 'helper.approval_attempt' AND target->>'sessionId' = ${sessionId}`;
    expect(attempts).toHaveLength(6);
    expect(attempts[0]?.target).toEqual({ sessionId, caseId: context.case.id });
    await enforceTurnRateLimit(database, { ...input, approvalAttempt: false });
  });
  test("FR-R4 even L3 helpers cannot request or answer a signature-field approval", async () => {
    const context = await fixture();
    const actor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "full" },
    });
    const ownerSession = await helperSession(context.ownerId);
    const helperSessionId = await helperSession(context.helperId);
    const common = {
      caseId: context.case.id,
      subjectId: context.subject.id,
      autonomyLevel: "L3" as const,
      shareScope: { mode: "full" },
      sentenceIndex: 0,
    };
    const ownerContext = {
      ...common,
      actorId: context.actor.id,
      userId: context.ownerId,
      sessionId: ownerSession,
      actorRole: "subject" as const,
    };
    const helperContext = {
      ...common,
      actorId: actor.id,
      userId: context.helperId,
      sessionId: helperSessionId,
      actorRole: "helper" as const,
    };
    const service = createApprovalService(database.db, randomUUID());
    // The synthetic signature field is a test-only approval binding, never a product form.
    const call = {
      approvalId: randomUUID(),
      toolCallId: randomUUID(),
      toolName: "form.commitGroup",
      input: { formInstanceId: randomUUID(), fieldIds: ["signature"], values: {} },
    };
    await expect(service.request(call, helperContext)).rejects.toMatchObject({
      code: "CONTINUATION_REJECTED",
    });
    await service.request(call, ownerContext);
    await expect(
      database.db.transaction((tx) => service.decide(tx, call, helperContext, true)),
    ).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
    const [approval] =
      await database.sql`SELECT decision, consumed_at FROM approval WHERE approval_id = ${call.approvalId}`;
    expect(approval?.decision).toBe("pending");
    expect(approval?.consumed_at).toBeNull();
  });

  test("FR-R5 an already running fact tool reloads revocations and helper turns remain bound to the joining session", async () => {
    const context = await fixture();
    await seedFacts(context.subject.id);
    const sessionId = await helperSession(context.helperId);
    const invite = await context.owner.inviteHelper({
      caseId: context.case.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const join = await context.helper.requestHelperJoin(invite.token, sessionId);
    await context.owner.approveHelperJoin(join.id);
    await expect(context.stranger.getHelperJoin(join.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    const session = { sessionId, userId: context.helperId, kind: "anonymous" as const };
    const request = {
      caseId: context.case.id,
      inputKind: "text" as const,
      capsule: {},
      actionResults: [],
    };
    const runtime = await database.db.transaction((tx) => resolveContext(tx, request, session));
    const tool = buildTools({ db: database.db, allowStubs: false })["context.queryFacts"];
    if (!tool.execute) throw new Error("Missing fact tool");
    const execute = () =>
      tool.execute?.(
        { subjectId: context.subject.id, factTypes: ["residence", "insurance"] },
        { context: runtime, toolCallId: randomUUID(), messages: [] },
      );
    expect(await execute()).toHaveLength(2);
    await context.owner.controlHelperSession({ joinId: join.id, action: "pause" });
    expect(await execute()).toEqual([]);
    await expect(
      database.db.transaction((tx) => resolveContext(tx, request, session)),
    ).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
    await context.owner.controlHelperSession({ joinId: join.id, action: "resume" });
    const otherSessionId = await helperSession(context.helperId);
    await expect(
      database.db.transaction((tx) =>
        resolveContext(tx, request, { ...session, sessionId: otherSessionId }),
      ),
    ).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
    expect((await context.helper.getHelperJoin(join.id)).status).toBe("active");
  });
  test("FR-R5 selected fact ids do not reveal another fact of the same type", async () => {
    const context = await fixture();
    await seedFacts(context.subject.id);
    const rows = await context.owner.factsVisibleTo(context.actor.id, context.subject.id);
    const selected = rows.find((row) => row.type === "residence");
    if (!selected) throw new Error("Missing fact fixture");
    await database.db.insert(facts).values({
      subjectId: context.subject.id,
      type: selected.type,
      value: "Other test statement",
      documentId: selected.documentId,
      source: { quote: "Other test statement" },
      confidence: 1,
      confirmed: true,
    });
    const actor = await context.owner.addCaseActor({
      caseId: context.case.id,
      userId: context.helperId,
      role: "helper",
      shareScope: { mode: "restricted", factTypes: [], factIds: [selected.id] },
    });
    const visible = await context.helper.factsVisibleTo(actor.id, context.subject.id);
    expect(visible.map((row) => row.id)).toEqual([selected.id]);
    const sessionId = await helperSession(context.helperId);
    const runtime = await database.db.transaction((tx) =>
      resolveContext(
        tx,
        { caseId: context.case.id, inputKind: "text", capsule: {}, actionResults: [] },
        { sessionId, userId: context.helperId, kind: "anonymous" },
      ),
    );
    const tool = buildTools({ db: database.db, allowStubs: false })["context.queryFacts"];
    if (!tool.execute) throw new Error("Missing fact tool");
    const result = await tool.execute(
      { subjectId: context.subject.id, factTypes: [selected.type] },
      { context: runtime, toolCallId: randomUUID(), messages: [] },
    );
    expect(result).toEqual([expect.objectContaining({ id: selected.id })]);
  });
});
