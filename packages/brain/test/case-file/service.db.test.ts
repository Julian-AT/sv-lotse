import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvals,
  auditEvents,
  caseActors,
  cases,
  documents,
  facts,
  formInstances,
  formTemplates,
  messages,
  reminders,
  subjects,
  turns,
  users,
} from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
  createCaseFileService,
  createHandoffService,
  createPortabilityService,
} from "../../src/case-file/index.ts";
import { handleTurn } from "../../src/conversation/index.ts";
import { buildTools } from "../../src/tools/registry.ts";
import {
  chunks,
  config,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
  userMessage,
} from "../runtime/helpers.ts";

// These are persistence/streaming tests. Keep classification and response guards isolated,
// as in runtime/turn.db.test.ts; provider behaviour belongs to the explicit live suites.
vi.mock("../../src/models/index.ts", () => ({
  createModelRouter: () => ({
    modelFor: () => {
      throw new Error("LIVE_MODEL_FORBIDDEN");
    },
  }),
}));
vi.mock("../../src/pipeline/classify.ts", () => ({
  classifyInput: async () => ({
    language: "de-AT",
    intent: "administrative",
    lifeSituation: null,
    candidateGoal: null,
    confirmsPendingGoal: false,
    factTypes: [],
  }),
}));
vi.mock("../../src/pipeline/guards.ts", async (original) => ({
  ...(await original<typeof import("../../src/pipeline/guards.ts")>()),
  guardAnswer: async (_config: unknown, text: string) => text,
}));
vi.mock("../../src/guards/index.ts", async (original) => ({
  ...(await original<typeof import("../../src/guards/index.ts")>()),
  createResponseGuard: () => async (input: { text: string }) => ({
    text: input.text,
    disposition: "allow",
  }),
}));

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let storage: ReturnType<typeof createObjectStorage>;
let caller: Awaited<ReturnType<typeof identity>>;
let subjectId: string;
let caseId: string;
let actorId: string;
let documentId: string;
const objectKeys = new Set<string>();

beforeAll(async () => {
  database = await isolatedDatabase();
  storage = createObjectStorage({ ...process.env, S3_PREFIX: `case-file-tests/${randomUUID()}` });
  await storage.headBucket();
});
afterAll(async () => {
  if (storage) {
    for (const key of objectKeys) await storage.delete(key);
    storage.close();
  }
  await database?.cleanup();
});
beforeEach(async () => {
  caller = await identity(database.db);
  subjectId = randomUUID();
  caseId = randomUUID();
  actorId = randomUUID();
  documentId = randomUUID();
  await database.db.insert(subjects).values({
    id: subjectId,
    displayName: "Testperson",
    relationToUser: "self",
    createdBy: caller.userId,
  });
  await database.db
    .insert(cases)
    .values({ id: caseId, subjectId, confirmedGoal: "Unterlagen vorbereiten" });
  await database.db
    .insert(caseActors)
    .values({ id: actorId, caseId, userId: caller.userId, role: "subject", shareScope: {} });
  const key = `subjects/${subjectId}/documents/${documentId}`;
  objectKeys.add(key);
  await storage.put(key, Buffer.from("Original file bytes, not a simulated service"), "text/plain");
  await database.db.insert(documents).values({
    id: documentId,
    subjectId,
    storageKey: key,
    type: "letter",
    hash: "fixture-hash",
    ocrStatus: "completed",
    originClient: "web",
  });
  // Synthetic user-owned provenance: the challenge originals do not supply mutable case histories.
  await database.db.insert(facts).values({
    subjectId,
    type: "document_reference",
    value: "Aktenzeichen 123",
    documentId,
    source: { documentId, page: 1, quote: "Aktenzeichen 123" },
    confirmed: true,
    confidence: 1,
  });
});

function service(userId = caller.userId) {
  return createCaseFileService(database.db, userId);
}
function portability(userId = caller.userId) {
  return createPortabilityService(database.db, storage, userId);
}
async function trackHandoff(id: string): Promise<void> {
  const [row] = await database.db.select().from(documents).where(eq(documents.id, id));
  if (row) objectKeys.add(row.storageKey);
}
const step = {
  processStep: "Unterlagen prüfen",
  status: "pending",
  owner: "user",
  dueAt: "2027-03-07T10:00:00Z",
  linkedArtifacts: [],
  initiatedBy: "user",
} as const;

test("FR-K1 persists step status, owner, due date and event snapshots and accepts partial updates", async () => {
  const created = await service().saveStep(caseId, step);
  expect(created.event.kind).toBe("step_created");
  const changed = await service().saveStep(
    caseId,
    { status: "completed", owner: "office" },
    created.step.id,
  );
  expect(changed.event.kind).toBe("step_completed");
  const result = await service().get(caseId);
  expect(result.steps[0]).toMatchObject({
    id: created.step.id,
    status: "completed",
    owner: "office",
    dueAt: new Date(step.dueAt),
  });
  const history = await service().history(caseId);
  expect(history.messages.map((row) => row.uiMessage.parts[0]?.type)).toEqual([
    "data-case-event",
    "data-case-event",
  ]);
  expect(history.entries.map((entry) => entry.at)).toEqual(
    history.entries.map((entry) => entry.at).sort(),
  );
  await service().update(caseId, { status: "paused" });
  expect(
    (await service().history(caseId)).entries.some((entry) => entry.kind === "case.updated"),
  ).toBe(true);
  expect((await service().get(caseId)).journeyMap).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: created.step.id, status: "completed" })]),
  );
});

test("FR-K4 history includes proposals, decisions, actions and audits without executing replay", async () => {
  await database.db.insert(messages).values({
    caseId,
    position: 0,
    uiMessage: {
      id: randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "tool-ui.fill",
          toolCallId: "recorded-call",
          state: "output-available",
          input: { value: "Test" },
          output: { success: true },
        },
      ],
    },
  });
  await database.db.insert(approvals).values({
    caseId,
    actorId,
    sessionId: caller.sessionId,
    approvalId: randomUUID(),
    toolCallId: "recorded-call",
    toolName: "ui.fill",
    inputHash: "a".repeat(64),
    hmac: "private-credential",
    decision: "approved",
    requestedAt: new Date("2026-01-01T10:00:00Z"),
    decidedAt: new Date("2026-01-01T10:00:01Z"),
  });
  await database.db
    .insert(auditEvents)
    .values({ actorId, action: "approval.approved", target: { caseId } });
  await database.db.insert(turns).values({
    caseId,
    status: "completed",
    actionResults: [{ success: true, actionId: "recorded-action" }],
  });
  const first = await service().history(caseId);
  expect(first.entries.map((entry) => entry.kind)).toEqual(
    expect.arrayContaining([
      "tool-ui.fill",
      "approval.requested",
      "approval.approved",
      "action.result",
    ]),
  );
  expect(JSON.stringify(first)).not.toContain("private-credential");
  expect(first.entries.find((entry) => entry.id.endsWith(":decided"))?.data).toMatchObject({
    toolName: "ui.fill",
    decision: "approved",
    actor: "you",
  });
  expect(await service().history(caseId)).toEqual(first);
  expect(await database.db.select().from(messages).where(eq(messages.caseId, caseId))).toHaveLength(
    1,
  );
});

test("FR-K3 creates a real scoped PDF in MinIO, records it and downloads it with authorization", async () => {
  await service().saveStep(caseId, step);
  const handoff = createHandoffService(database.db, storage, caller.userId);
  const result = await handoff.compose(caseId, ["steps", "facts"]);
  await trackHandoff(result.documentKey);
  const bytes = await handoff.download(caseId, result.documentKey);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  expect(pdf.getTitle()).toContain("Fallübersicht");
  expect(
    (await service().history(caseId)).entries.some((entry) => entry.kind === "data-case-event"),
  ).toBe(true);
  // Retained for visual review outside the product; the actual document is stored in MinIO.
  await writeFile(join(tmpdir(), "lotse-case-file-handoff.pdf"), bytes);
  await expect(handoff.compose(caseId, ["invented-scope"])).rejects.toMatchObject({
    code: "invalid_input",
  });
});

test("FR-P5 exports originals, generated forms, facts, cases, approvals and audit as a valid zip", async () => {
  const templateId = randomUUID();
  await database.db.insert(formTemplates).values({
    id: templateId,
    publisher: "Test",
    title: "Test",
    source: "https://example.org/test",
    hash: "hash",
    format: "flat",
    pages: 1,
    schema: {},
    storageKey: "shared-template",
  });
  const outputKey = `subjects/${subjectId}/form-output.pdf`;
  objectKeys.add(outputKey);
  await storage.put(outputKey, Buffer.from("generated form bytes"));
  const [form] = await database.db
    .insert(formInstances)
    .values({ caseId, subjectId, templateId, fields: {}, outputKey })
    .returning();
  const summary = await createHandoffService(database.db, storage, caller.userId).compose(caseId);
  await trackHandoff(summary.documentKey);
  await database.db
    .insert(auditEvents)
    .values({ actorId, action: "case.export_requested", target: { caseId } });
  const zip = unzipSync(await portability().export());
  const json = zip["data.json"];
  if (!json) throw new Error("Missing data JSON");
  const data = JSON.parse(strFromU8(json));
  expect(data.subjects).toHaveLength(1);
  expect(data.facts[0].source.quote).toBe("Aktenzeichen 123");
  expect(data.auditEvents).toHaveLength(1);
  expect(data.messages).toHaveLength(1);
  expect(strFromU8(zip[`documents/${documentId}`] ?? new Uint8Array())).toContain(
    "Original file bytes",
  );
  expect(strFromU8(zip[`forms/${form?.id}.pdf`] ?? new Uint8Array())).toBe("generated form bytes");
  expect(zip[`documents/${summary.documentKey}`]?.length).toBeGreaterThan(0);
});

test("FR-P5 subject deletion removes database context and all subject objects but preserves other subjects and opaque audit", async () => {
  const otherSubject = randomUUID();
  await database.db.insert(subjects).values({
    id: otherSubject,
    displayName: "Other",
    relationToUser: "relative",
    createdBy: caller.userId,
  });
  const summary = await createHandoffService(database.db, storage, caller.userId).compose(caseId);
  await trackHandoff(summary.documentKey);
  await service().saveStep(caseId, step);
  await database.db
    .insert(reminders)
    .values({ caseId, dueAt: new Date(step.dueAt), source: { quote: "Original quote" } });
  await database.db
    .insert(auditEvents)
    .values({ actorId, action: "case.read", target: { caseId } });
  const result = await portability().delete(subjectId);
  expect(result.deletedSubjects).toEqual([subjectId]);
  expect(await database.db.select().from(cases).where(eq(cases.id, caseId))).toEqual([]);
  expect(await database.db.select().from(facts).where(eq(facts.subjectId, subjectId))).toEqual([]);
  expect(
    await database.db.select().from(documents).where(eq(documents.subjectId, subjectId)),
  ).toEqual([]);
  expect(await database.db.select().from(messages).where(eq(messages.caseId, caseId))).toEqual([]);
  expect(
    await database.db.select().from(subjects).where(eq(subjects.id, otherSubject)),
  ).toHaveLength(1);
  expect(
    await database.db.select().from(auditEvents).where(eq(auditEvents.actorId, actorId)),
  ).toHaveLength(1);
  for (const key of objectKeys)
    if (key.includes(subjectId)) await expect(storage.get(key)).rejects.toBeDefined();
  expect(await database.db.select().from(users).where(eq(users.id, caller.userId))).toHaveLength(1);
  await portability().delete();
  expect(await database.db.select().from(users).where(eq(users.id, caller.userId))).toEqual([]);
});

test("FR-P5 rejects outsiders and restricted helpers before exposing history, exports or objects", async () => {
  const helper = await identity(database.db);
  await database.db.insert(caseActors).values({
    caseId,
    userId: helper.userId,
    role: "helper",
    shareScope: { mode: "restricted", factTypes: [] },
  });
  expect(await service(helper.userId).list()).toEqual([]);
  await expect(service(helper.userId).history(caseId)).rejects.toMatchObject({
    code: "access_denied",
  });
  await expect(portability(helper.userId).export(subjectId)).rejects.toMatchObject({
    code: "access_denied",
  });
  await expect(portability(helper.userId).delete(subjectId)).rejects.toMatchObject({
    code: "access_denied",
  });
  expect(
    unzipSync(await portability(helper.userId).export())[`documents/${documentId}`],
  ).toBeUndefined();
  await expect(service(helper.userId).saveStep(caseId, step)).rejects.toMatchObject({
    code: "access_denied",
  });
});

test("FR-K1 case.update streams durable data-case-event parts through the real turn adapter", async () => {
  const response = await handleTurn({ ...turn, caseId }, userMessage(), caller, {
    db: database.db,
    config,
    model: forcedModel("case.update", { caseId, patch: { confirmedGoal: "Beratung vorbereiten" } }),
  });
  const events = await chunks(response);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "data-case-event",
        data: { caseId, kind: "goal_confirmed", payload: { goal: "Beratung vorbereiten" } },
      }),
    ]),
  );
  expect(
    (await service().history(caseId)).messages.some((row) =>
      row.uiMessage.parts.some((part) => part.type === "data-case-event"),
    ),
  ).toBe(true);
});

test("FR-K3 registered handoff.compose uses real storage and returns an artefact event without a stub", async () => {
  const events: unknown[] = [];
  const execute = buildTools({
    allowStubs: false,
    db: database.db,
    storage,
    writer: {
      write: (event) => {
        events.push(event);
      },
    },
  })["handoff.compose"].execute;
  if (!execute) throw new Error("Missing handoff implementation");
  const output = await execute(
    { caseId, scope: ["steps"] },
    {
      context: {
        ...caller,
        caseId,
        subjectId,
        actorId,
        actorRole: "subject",
        autonomyLevel: "L2",
        shareScope: {},
        sentenceIndex: 0,
      },
      toolCallId: randomUUID(),
      messages: [],
    },
  );
  const result = output as { documentKey: string };
  await trackHandoff(result.documentKey);
  expect(events).toContainEqual({
    type: "data-case-event",
    data: { caseId, kind: "artefact_ready", payload: result },
  });
  expect(
    (
      await createHandoffService(database.db, storage, caller.userId).download(
        caseId,
        result.documentKey,
      )
    )
      .subarray(0, 4)
      .toString(),
  ).toBe("%PDF");
});

test("FR-P5 preserves references after a storage deletion failure so the operation can be retried", async () => {
  let failOnce = true;
  const faultInjectedStorage = {
    put: storage.put,
    get: storage.get,
    delete: async (key: string): Promise<void> => {
      // Test-only fault injection over the real MinIO client.
      if (failOnce) {
        failOnce = false;
        throw new Error("Injected storage outage");
      }
      await storage.delete(key);
    },
  };
  const deletion = createPortabilityService(database.db, faultInjectedStorage, caller.userId);
  await expect(deletion.delete(subjectId)).rejects.toMatchObject({ code: "operation_failed" });
  expect(
    await database.db.select().from(documents).where(eq(documents.subjectId, subjectId)),
  ).toHaveLength(1);
  await deletion.delete(subjectId);
  expect(await database.db.select().from(subjects).where(eq(subjects.id, subjectId))).toEqual([]);
});

test("FR-P5 deleting one subject retains a deduplicated object still referenced by another subject", async () => {
  const otherSubject = randomUUID();
  await database.db.insert(subjects).values({
    id: otherSubject,
    displayName: "Other",
    relationToUser: "relative",
    createdBy: caller.userId,
  });
  const [original] = await database.db.select().from(documents).where(eq(documents.id, documentId));
  if (!original) throw new Error("Missing original");
  await database.db.insert(documents).values({
    subjectId: otherSubject,
    type: original.type,
    storageKey: original.storageKey,
    hash: original.hash,
    originClient: "web",
  });
  await portability().delete(subjectId);
  expect((await storage.get(original.storageKey)).toString()).toContain("Original file bytes");
});

test("FR-K1 refuses HTTP-style history mutations during a running turn and leaves message positions intact", async () => {
  await database.db.insert(turns).values({ caseId, status: "running" });
  await expect(service().saveStep(caseId, step)).rejects.toMatchObject({ code: "case_busy" });
  await expect(service().update(caseId, { confirmedGoal: "Other" })).rejects.toMatchObject({
    code: "case_busy",
  });
  await expect(
    createHandoffService(database.db, storage, caller.userId).compose(caseId),
  ).rejects.toMatchObject({ code: "case_busy" });
  expect((await service().history(caseId)).messages).toEqual([]);
});

test("FR-K3 a helper cannot use a full share of one case to download a different case summary", async () => {
  const result = await createHandoffService(database.db, storage, caller.userId).compose(caseId);
  await trackHandoff(result.documentKey);
  const secondCase = randomUUID();
  await database.db
    .insert(cases)
    .values({ id: secondCase, subjectId, confirmedGoal: "Other case" });
  const helper = await identity(database.db);
  await database.db.insert(caseActors).values({
    caseId: secondCase,
    userId: helper.userId,
    role: "helper",
    shareScope: { mode: "full" },
  });
  await expect(
    createHandoffService(database.db, storage, helper.userId).download(
      secondCase,
      result.documentKey,
    ),
  ).rejects.toMatchObject({ code: "not_found" });
});
