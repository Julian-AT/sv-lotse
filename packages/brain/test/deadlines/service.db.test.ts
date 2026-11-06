import { randomUUID } from "node:crypto";
import {
  createDeadlineService,
  exportRemindersCalendar,
  syncCaseDeadlines,
} from "@lotse/brain/deadlines";
import {
  caseActors,
  caseSteps,
  cases,
  documents,
  facts,
  reminders,
  subjects,
  users,
} from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import * as letter from "../../src/deadlines/letter.ts";
import { buildTools } from "../../src/tools/registry.ts";
import { isolatedDatabase } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let context: RuntimeContext;
let factId: string;
let documentId: string;
const quote = "Bitte reichen Sie die Unterlagen bis 07.03.2027 ein.";
const relative = "Antworten Sie innerhalb von zwei Wochen nach Zustellung.";
const pages = [{ page: 1, text: `${quote}\n${relative}`, lines: [] }];

beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  await database?.cleanup();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  const userId = randomUUID();
  const subjectId = randomUUID();
  const caseId = randomUUID();
  const actorId = randomUUID();
  factId = randomUUID();
  documentId = randomUUID();
  await database.db.insert(users).values({ id: userId });
  await database.db.insert(subjects).values({
    id: subjectId,
    displayName: "Testperson",
    relationToUser: "self",
    createdBy: userId,
  });
  await database.db
    .insert(cases)
    .values({ id: caseId, subjectId, confirmedGoal: "Unterlagen einreichen" });
  await database.db
    .insert(caseActors)
    .values({ id: actorId, caseId, userId, role: "subject", shareScope: {} });
  await database.db.insert(documents).values({
    id: documentId,
    subjectId,
    type: "letter",
    storageKey: randomUUID(),
    hash: "fixture-hash",
    pages,
    ocrStatus: "completed",
    originClient: "web",
  });
  // Constructed deadline envelopes cover cases absent from the real challenge data.
  await database.db.insert(facts).values({
    id: factId,
    subjectId,
    type: "deadline",
    value: { title: "Unterlagen einreichen", dueAt: "2027-03-07" },
    documentId,
    source: { documentId, page: 1, quote },
    confidence: 1,
    confirmed: true,
  });
  context = {
    caseId,
    subjectId,
    actorId,
    userId,
    sessionId: randomUUID(),
    actorRole: "subject",
    autonomyLevel: "L1",
    shareScope: {},
    sentenceIndex: 0,
  };
});

function service(userId = context.userId) {
  return createDeadlineService(database.db, userId);
}
function mockAnalysis() {
  return vi.spyOn(letter, "analyzeLetter").mockImplementation(async (sourcePages) =>
    letter.groundLetterAnalysis(
      {
        kind: "administrative",
        summary: { text: "Die Stelle bittet um Unterlagen.", quote, page: 1 },
        requiredActions: [{ text: "Reichen Sie die Unterlagen ein.", quote, page: 1 }],
        deadlines: [
          { title: "Unterlagen einreichen", quote, page: 1, dueAt: "2027-03-07" },
          { title: "Antworten", quote: relative, page: 1, dueAt: null },
        ],
        nextSteps: [],
      },
      sourcePages,
    ),
  );
}

test("FR-K2 registered reminder.create stores an exportable idempotent reminder in real Postgres", async () => {
  const tools = buildTools({ allowStubs: false, db: database.db });
  const execute = tools["reminder.create"].execute;
  if (!execute) throw new Error("Missing reminder tool");
  const input = {
    caseId: context.caseId,
    title: "Unterlagen einreichen",
    dueAt: "2027-03-07",
    sourceQuote: quote,
  };
  const options = { context, toolCallId: randomUUID(), messages: [] };
  const first = await execute(input, options);
  expect(await execute(input, options)).toEqual(first);
  const stored = await service().list(context.caseId);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    dueAt: new Date("2027-03-07T22:59:59.999Z"),
    source: { kind: "manual", sourceQuote: quote },
  });
  expect(exportRemindersCalendar(stored, new Date())).toContain("DTSTART;VALUE=DATE:20270307");
});

test("FR-K2 reconciles confirmed facts without deleting process or manual reminders", async () => {
  const stepId = randomUUID();
  await database.db.insert(caseSteps).values({
    id: stepId,
    caseId: context.caseId,
    processStep: "next",
    owner: "user",
    initiatedBy: "pilot",
    dueAt: new Date("2027-04-01T10:00:00Z"),
  });
  await syncCaseDeadlines(database, {
    caseId: context.caseId,
    stepSources: [{ stepId, title: "Unterlagen prüfen", sourceQuote: quote }],
  });
  const manual = await service().create({
    caseId: context.caseId,
    title: "Antworten",
    dueAt: "2027-05-01T10:00:00Z",
    sourceQuote: quote,
  });
  const runs = await Promise.all([
    service().extract({ caseId: context.caseId }),
    service().extract({ caseId: context.caseId }),
  ]);
  expect(runs[0]).toEqual(runs[1]);
  expect(runs[0]?.reminders).toHaveLength(3);
  const factReminder = runs[0]?.reminders.find((row) => row.source.key === `fact:${factId}`);
  await database.db
    .update(facts)
    .set({ value: { title: "Neue Frist", dueAt: "2027-03-08" } })
    .where(eq(facts.id, factId));
  const updated = await service().extract({ caseId: context.caseId });
  expect(updated.reminders.find((row) => row.id === factReminder?.id)?.source.date).toBe(
    "2027-03-08",
  );
  await database.db.update(facts).set({ confirmed: false }).where(eq(facts.id, factId));
  const remaining = await service().extract({ caseId: context.caseId });
  expect(remaining.reminders).toHaveLength(2);
  expect(remaining.reminders.some((row) => row.id === manual.id)).toBe(true);
  expect(remaining.reminders.some((row) => row.source.key === `step:${stepId}`)).toBe(true);
});

test("FR-D8 explains a stored letter without writes; extraction stores only absolute sourced deadlines", async () => {
  mockAnalysis();
  const explanation = await service().explainLetter(context.caseId, documentId);
  expect(explanation.requiredActions[0]?.quote).toBe(quote);
  expect(await service().list(context.caseId)).toEqual([]);
  const result = await service().extract({ caseId: context.caseId, documentId });
  expect(result.reminders.filter((row) => row.source.kind === "letter")).toHaveLength(1);
  expect(result.unresolvedDeadlines).toEqual([
    { title: "Antworten", quote: relative, page: 1, dueAt: null },
  ]);
  expect(result.reminders.find((row) => row.source.kind === "letter")?.source.provenance).toEqual({
    documentId,
    page: 1,
    quote,
  });
  expect(await service().extract({ caseId: context.caseId, documentId })).toEqual(result);
});

test("FR-K2 and FR-D8 registry tools explain, extract and list persisted sourced reminders", async () => {
  mockAnalysis();
  const tools = buildTools({ allowStubs: false, db: database.db });
  const explain = tools["docs.explainLetter"].execute;
  const extract = tools["reminder.extract"].execute;
  const list = tools["reminder.list"].execute;
  if (!explain || !extract || !list) throw new Error("Missing deadline tools");
  const options = { context, toolCallId: randomUUID(), messages: [] };
  const input = { caseId: context.caseId, documentId };

  expect(await explain(input, options)).toMatchObject({
    documentId,
    requiredActions: [{ quote, page: 1 }],
  });
  expect(await list({ caseId: context.caseId }, options)).toEqual([]);
  expect(await extract(input, options)).toMatchObject({
    reminders: expect.arrayContaining([
      expect.objectContaining({ dueAt: "2027-03-07", sourceQuote: quote }),
    ]),
    unresolvedDeadlines: [{ title: "Antworten", quote: relative, page: 1, dueAt: null }],
  });
  const records = await list({ caseId: context.caseId }, options);
  expect(records).toHaveLength(2);
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: expect.objectContaining({ kind: "letter" }) }),
      expect.objectContaining({ source: expect.objectContaining({ kind: "deadline" }) }),
    ]),
  );
  expect(exportRemindersCalendar(await service().list(context.caseId), new Date())).toContain(
    `DESCRIPTION:${quote}`,
  );
});

test("deadline registry tools refuse a case outside the active conversation before analysis", async () => {
  const provider = mockAnalysis();
  const tools = buildTools({ allowStubs: false, db: database.db });
  const options = { context, toolCallId: randomUUID(), messages: [] };
  const caseId = randomUUID();
  for (const name of ["docs.explainLetter", "reminder.extract", "reminder.list"] as const) {
    const execute = tools[name].execute;
    if (!execute) throw new Error("Missing deadline tool");
    const input = name === "reminder.list" ? { caseId } : { caseId, documentId };
    await expect(execute(input, options)).rejects.toMatchObject({ code: "access_denied" });
  }
  expect(provider).not.toHaveBeenCalled();
  expect(await service().list(context.caseId)).toEqual([]);
});

test("FR-K2 excludes unconfirmed and undated facts from reminder extraction", async () => {
  await database.db.update(facts).set({ confirmed: false }).where(eq(facts.id, factId));
  expect((await service().extract({ caseId: context.caseId })).reminders).toEqual([]);
  await database.db
    .update(facts)
    .set({ confirmed: true, value: { title: "Antworten", dueAt: "zwei Wochen" } })
    .where(eq(facts.id, factId));
  expect((await service().extract({ caseId: context.caseId })).reminders).toEqual([]);
});

test("denies other users, helper actors and cross-subject letters before calling the provider", async () => {
  const provider = mockAnalysis();
  const outsider = randomUUID();
  await database.db.insert(users).values({ id: outsider });
  await expect(service(outsider).list(context.caseId)).rejects.toMatchObject({
    code: "access_denied",
  });
  await database.db.insert(caseActors).values({
    caseId: context.caseId,
    userId: outsider,
    role: "helper",
    shareScope: { facts: true, case: true },
  });
  await expect(
    service(outsider).extract({ caseId: context.caseId, documentId }),
  ).rejects.toMatchObject({ code: "access_denied" });
  const otherSubject = randomUUID();
  await database.db.insert(subjects).values({
    id: otherSubject,
    displayName: "Andere Testperson",
    relationToUser: "relative",
    createdBy: context.userId,
  });
  await database.db
    .update(documents)
    .set({ subjectId: otherSubject })
    .where(eq(documents.id, documentId));
  await expect(service().explainLetter(context.caseId, documentId)).rejects.toMatchObject({
    code: "access_denied",
  });
  expect(provider).not.toHaveBeenCalled();
});

test("does not call the model for pending OCR and keeps original reminder.create records exportable", async () => {
  const provider = mockAnalysis();
  await database.db
    .update(documents)
    .set({ ocrStatus: "pending" })
    .where(eq(documents.id, documentId));
  await expect(service().explainLetter(context.caseId, documentId)).rejects.toMatchObject({
    code: "document_not_ready",
  });
  expect(provider).not.toHaveBeenCalled();
  await database.db.insert(reminders).values({
    caseId: context.caseId,
    dueAt: new Date("2027-03-07T10:00:00Z"),
    source: { title: "Unterlagen", quote },
  });
  expect(exportRemindersCalendar(await service().list(context.caseId), new Date())).toContain(
    `DESCRIPTION:${quote}`,
  );
});

test("rolls back extraction on an ungrounded model quote", async () => {
  vi.spyOn(letter, "analyzeLetter").mockImplementation(async (sourcePages) =>
    letter.groundLetterAnalysis(
      {
        kind: "administrative",
        summary: { text: "Unbelegt", quote: "not in document", page: 1 },
        requiredActions: [],
        deadlines: [],
        nextSteps: [],
      },
      sourcePages,
    ),
  );
  await expect(service().extract({ caseId: context.caseId, documentId })).rejects.toMatchObject({
    code: "ungrounded_letter",
  });
  expect(await service().list(context.caseId)).toEqual([]);
});

test.each(["explain", "extract"] as const)(
  "FR-D8 refuses stale letter OCR during %s without persisting deadlines",
  async (operation) => {
    const provider = mockAnalysis();
    const analyze = provider.getMockImplementation();
    if (!analyze) throw new Error("Missing test analysis");
    provider.mockImplementation(async (...args) => {
      const result = await analyze(...args);
      // OCR corrections can change the page text without changing the original file hash.
      await database.db
        .update(documents)
        .set({ pages: [{ page: 1, text: "Dieses Schreiben wurde berichtigt.", lines: [] }] })
        .where(eq(documents.id, documentId));
      return result;
    });

    const result =
      operation === "explain"
        ? service().explainLetter(context.caseId, documentId)
        : service().extract({ caseId: context.caseId, documentId });

    await expect(result).rejects.toMatchObject({ code: "document_not_ready" });
    expect(await service().list(context.caseId)).toEqual([]);
  },
);

test("FR-D8 refuses OCR that is no longer completed after analysis", async () => {
  const provider = mockAnalysis();
  const analyze = provider.getMockImplementation();
  if (!analyze) throw new Error("Missing test analysis");
  provider.mockImplementation(async (...args) => {
    const result = await analyze(...args);
    await database.db
      .update(documents)
      .set({ ocrStatus: "processing" })
      .where(eq(documents.id, documentId));
    return result;
  });

  await expect(service().extract({ caseId: context.caseId, documentId })).rejects.toMatchObject({
    code: "document_not_ready",
  });
  expect(await service().list(context.caseId)).toEqual([]);
});
