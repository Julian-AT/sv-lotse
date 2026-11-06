import { createHash, randomUUID } from "node:crypto";
import { createDocumentService } from "@lotse/brain/documents";
import { createRelativeService } from "@lotse/brain/relatives";
import { createSubjectService } from "@lotse/brain/subjects";
import { createWorkspaceService } from "@lotse/brain/workspace";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { caseSteps, documents, facts, messages, sessions, users } from "@lotse/db/schema";
import { afterAll, beforeAll, expect, test } from "vitest";
import { loadLocalEnvironment } from "../../scripts/load-env.mjs";

loadLocalEnvironment();
const admin = createDatabase();
const databaseName = `lotse_relatives_${randomUUID().replaceAll("-", "")}`;
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
  if (created) await admin.sql`DROP DATABASE ${admin.sql(databaseName)} WITH (FORCE)`;
  await admin.close();
});

async function browser() {
  const identity = { userId: randomUUID(), sessionId: randomUUID() };
  await database.db.insert(users).values({ id: identity.userId });
  await database.db.insert(sessions).values({
    id: identity.sessionId,
    userId: identity.userId,
    clientKind: "web",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { identity, service: createRelativeService(database, identity) };
}

async function fixture() {
  const owner = await browser();
  const helper = await browser();
  const stranger = await browser();
  const subjects = createSubjectService(database, owner.identity.userId);
  const subject = await subjects.createSubject({
    displayName: "Testperson",
    relationToUser: "self",
  });
  const result = await subjects.createCase({
    subjectId: subject.id,
    confirmedGoal: "Unterstützung beim Antrag",
  });
  return { owner, helper, stranger, caseId: result.case.id, subjectId: subject.id };
}

test("FR-R1 a join stays pending until the inviting browser approves it; no case or fact access is granted", async () => {
  const { owner, helper, stranger, caseId } = await fixture();
  await expect(helper.service.createInvite(caseId)).rejects.toMatchObject({ code: "forbidden" });
  const invite = await owner.service.createInvite(caseId);
  const [stored] =
    await database.sql`SELECT token_hash FROM helper_invite WHERE token_hash = ${createHash("sha256").update(invite.token).digest("hex")}`;
  expect(stored?.token_hash).not.toBe(invite.token);
  expect((await helper.service.joinInvite(invite.token)).state).toBe("pending");
  await expect(helper.service.roomAccess(invite.id)).rejects.toMatchObject({
    code: "SESSION_NOT_APPROVED",
  });
  await expect(owner.service.roomAccess(invite.id)).rejects.toMatchObject({
    code: "SESSION_NOT_APPROVED",
  });
  await expect(helper.service.approve(invite.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(stranger.service.getSession(invite.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await owner.service.approve(invite.id)).state).toBe("approved");
  expect(await helper.service.roomAccess(invite.id)).toMatchObject({
    role: "helper",
    room: `relative-${invite.id}`,
    identity: `helper-${helper.identity.sessionId}`,
  });
  expect((await owner.service.roomAccess(invite.id)).role).toBe("subject");
  expect(
    await database.sql`SELECT id FROM case_actor WHERE user_id = ${helper.identity.userId}`,
  ).toHaveLength(0);
  const [record] = await database.sql`SELECT scope FROM helper_session WHERE id = ${invite.id}`;
  expect(record?.scope).toMatchObject({
    status: "active",
    sessionId: helper.identity.sessionId,
    shareScope: { mode: "restricted", case: false, factTypes: [] },
  });
  await helper.service.end(invite.id);
  await expect(owner.service.roomAccess(invite.id)).rejects.toMatchObject({
    code: "SESSION_NOT_APPROVED",
  });
  const [ended] = await database.sql`SELECT ended_at FROM helper_session WHERE id = ${invite.id}`;
  expect(ended?.ended_at).not.toBeNull();
});

test("FR-R1 a single-use invite resists concurrent claims and reloads are idempotent", async () => {
  const { owner, helper, stranger, caseId } = await fixture();
  const invite = await owner.service.createInvite(caseId);
  const results = await Promise.allSettled([
    helper.service.joinInvite(invite.token),
    stranger.service.joinInvite(invite.token),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const winner = results[0]?.status === "fulfilled" ? helper : stranger;
  expect((await winner.service.joinInvite(invite.token)).id).toBe(invite.id);
  await expect(owner.service.joinInvite(invite.token)).rejects.toMatchObject({
    code: "INVITE_UNAVAILABLE",
  });
});

test("FR-R1 expired invites and reset browser sessions never receive media tokens", async () => {
  const { owner, helper, caseId } = await fixture();
  const invite = await owner.service.createInvite(caseId);
  await database.sql`UPDATE relative_session SET created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' WHERE id = ${invite.id}`;
  await expect(helper.service.joinInvite(invite.token)).rejects.toMatchObject({
    code: "INVITE_UNAVAILABLE",
  });
  const fresh = await owner.service.createInvite(caseId);
  await helper.service.joinInvite(fresh.token);
  await owner.service.approve(fresh.id);
  await database.sql`UPDATE session SET created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' WHERE id = ${helper.identity.sessionId}`;
  expect((await owner.service.getSession(fresh.id)).state).toBe("ended");
  await expect(owner.service.roomAccess(fresh.id)).rejects.toMatchObject({
    code: "SESSION_NOT_APPROVED",
  });
});

// Constructed administrative fixtures isolate scope behavior without provider calls or private data.
async function contextFixture() {
  const context = await fixture();
  const [document] = await database.db
    .insert(documents)
    .values({
      subjectId: context.subjectId,
      type: "uploaded_document",
      storageKey: `test/${randomUUID()}`,
      hash: randomUUID(),
      pages: [],
      ocrStatus: "completed",
      originClient: "web",
    })
    .returning();
  if (!document) throw new Error("DOCUMENT_FIXTURE_MISSING");
  const saved = await database.db
    .insert(facts)
    .values([
      {
        subjectId: context.subjectId,
        type: "administrative_fact",
        value: "Shared value",
        confirmed: true,
        confidence: 1,
        documentId: document.id,
        source: { kind: "document", documentId: document.id, quote: "Shared quote" },
      },
      {
        subjectId: context.subjectId,
        type: "administrative_fact",
        value: "Private value",
        confirmed: true,
        confidence: 1,
        documentId: document.id,
        source: { kind: "document", documentId: document.id, quote: "Private quote" },
      },
    ])
    .returning();
  await database.db.insert(caseSteps).values({
    caseId: context.caseId,
    processStep: "Unterlagen prüfen",
    status: "in_progress",
    owner: "user",
    initiatedBy: "user",
    linkedArtifacts: [{ privateValue: "Never expose an artifact through the journey" }],
  });
  await database.db.insert(messages).values({
    caseId: context.caseId,
    position: 0,
    uiMessage: {
      id: randomUUID(),
      role: "assistant",
      parts: [{ type: "text", text: "Never expose private facts from owner conversation" }],
    },
  });
  return { ...context, document, saved };
}
function helperDocuments(helper: Awaited<ReturnType<typeof browser>>) {
  return createDocumentService(database.db, helper.identity.userId, {
    sessionId: helper.identity.sessionId,
  });
}

test("FR-R5 screen-only approval denies facts and the journey before and after joining", async () => {
  const { owner, helper, caseId, subjectId, document } = await contextFixture();
  const invite = await owner.service.createInvite(caseId, {
    mode: "restricted",
    case: false,
    factTypes: [],
  });
  const workspace = createWorkspaceService(
    database.db,
    helper.identity.userId,
    helper.identity.sessionId,
  );
  const service = helperDocuments(helper);
  await helper.service.joinInvite(invite.token);
  await expect(workspace.snapshot({ caseId })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  await owner.service.approve(invite.id);
  await expect(service.listFacts({ caseId, subjectId })).rejects.toMatchObject({
    code: "access_denied",
  });
  await expect(service.read({ caseId, subjectId, documentId: document.id })).rejects.toMatchObject({
    code: "access_denied",
  });
  await expect(workspace.snapshot({ caseId })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
});

test("FR-R5 case sharing exposes the journey while facts, documents and conversation artifacts remain private", async () => {
  const { owner, helper, caseId, subjectId, document } = await contextFixture();
  const invite = await owner.service.createInvite(caseId, {
    mode: "restricted",
    case: true,
    factTypes: [],
  });
  await helper.service.joinInvite(invite.token);
  await owner.service.approve(invite.id);
  const snapshot = await createWorkspaceService(
    database.db,
    helper.identity.userId,
    helper.identity.sessionId,
  ).snapshot({ caseId });
  expect(snapshot.steps).toMatchObject([{ title: "Unterlagen prüfen", status: "current" }]);
  expect(snapshot.documents).toEqual([]);
  expect(snapshot.events).toEqual([]);
  expect(JSON.stringify(snapshot)).not.toContain("Never expose");
  expect(await helperDocuments(helper).listFacts({ caseId, subjectId })).toEqual([]);
  await expect(
    helperDocuments(helper).read({ caseId, subjectId, documentId: document.id }),
  ).rejects.toMatchObject({ code: "access_denied" });
});

test("FR-R5 selected fact ids never broaden to another fact of the same type or its source document", async () => {
  const { owner, helper, caseId, subjectId, document, saved } = await contextFixture();
  const selected = saved[0];
  if (!selected) throw new Error("FACT_FIXTURE_MISSING");
  const scope = { mode: "restricted" as const, case: true, factTypes: [], factIds: [selected.id] };
  const invite = await owner.service.createInvite(caseId, scope);
  await helper.service.joinInvite(invite.token);
  await owner.service.approve(invite.id);
  const service = helperDocuments(helper);
  expect((await service.listFacts({ caseId, subjectId })).map((fact) => fact.id)).toEqual([
    selected.id,
  ]);
  expect(await service.listFacts({ caseId, subjectId, factTypes: ["unshared_type"] })).toEqual([]);
  const [actor] =
    await database.sql`SELECT id FROM case_actor WHERE case_id = ${caseId} AND user_id = ${helper.identity.userId}`;
  const visibility = createSubjectService(
    database,
    helper.identity.userId,
    helper.identity.sessionId,
  );
  expect((await visibility.factsVisibleTo(actor?.id, subjectId)).map((fact) => fact.id)).toEqual([
    selected.id,
  ]);
  expect(await visibility.documentsVisibleTo(actor?.id, subjectId)).toEqual([]);
  await expect(service.read({ caseId, subjectId, documentId: document.id })).rejects.toMatchObject({
    code: "access_denied",
  });
  const replacement = await browser();
  await database.sql`UPDATE session SET user_id = ${helper.identity.userId} WHERE id = ${replacement.identity.sessionId}`;
  await expect(
    createDocumentService(database.db, helper.identity.userId, {
      sessionId: replacement.identity.sessionId,
    }).listFacts({ caseId, subjectId }),
  ).rejects.toMatchObject({ code: "access_denied" });
  await expect(
    createWorkspaceService(
      database.db,
      helper.identity.userId,
      replacement.identity.sessionId,
    ).snapshot({ caseId }),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  await owner.service.control(invite.id, "pause");
  await expect(service.listFacts({ caseId, subjectId })).rejects.toMatchObject({
    code: "access_denied",
  });
  expect(await visibility.factsVisibleTo(actor?.id, subjectId)).toEqual([]);
  await owner.service.control(invite.id, "resume");
  expect((await service.listFacts({ caseId, subjectId })).map((fact) => fact.id)).toEqual([
    selected.id,
  ]);
  await helper.service.end(invite.id);
  await expect(service.listFacts({ caseId, subjectId })).rejects.toMatchObject({
    code: "access_denied",
  });
  expect(await visibility.factsVisibleTo(actor?.id, subjectId)).toEqual([]);
});

test("FR-R5 every helper read rechecks the relative and owner browser expiry", async () => {
  const { owner, helper, caseId, subjectId, saved } = await contextFixture();
  const selected = saved[0];
  if (!selected) throw new Error("FACT_FIXTURE_MISSING");
  const invite = await owner.service.createInvite(caseId, {
    mode: "restricted",
    case: true,
    factTypes: [],
    factIds: [selected.id],
  });
  await helper.service.joinInvite(invite.token);
  await owner.service.approve(invite.id);
  const service = helperDocuments(helper);
  await database.sql`UPDATE relative_session SET created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' WHERE id = ${invite.id}`;
  await expect(service.listFacts({ caseId, subjectId })).rejects.toMatchObject({
    code: "access_denied",
  });
  await database.sql`UPDATE relative_session SET expires_at = clock_timestamp() + interval '1 hour' WHERE id = ${invite.id}`;
  await database.sql`UPDATE session SET created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' WHERE id = ${owner.identity.sessionId}`;
  await expect(service.listFacts({ caseId, subjectId })).rejects.toMatchObject({
    code: "access_denied",
  });
  await expect(
    createWorkspaceService(database.db, helper.identity.userId, helper.identity.sessionId).snapshot(
      { caseId },
    ),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
});
