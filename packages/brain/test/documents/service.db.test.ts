import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { benefits, caseActors, cases, documents, facts, subjects } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { JsonObjectSchema } from "@lotse/protocol";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { parse } from "yaml";
import type { RuntimeContext } from "../../src/agent/context.ts";
import * as extraction from "../../src/documents/extraction.ts";
import { signProposal } from "../../src/documents/proposals.ts";
import { documentPagesSchema } from "../../src/documents/schema.ts";
import { createDocumentService } from "../../src/documents/service.ts";
import { benefitRecordSchema } from "../../src/tools/contracts/records.ts";
import { implementations as contextTools } from "../../src/tools/impl/context/index.ts";
import { implementations as docsTools } from "../../src/tools/impl/docs/index.ts";
import { implementations as documentTools } from "../../src/tools/impl/documents/index.ts";
import { identity, isolatedDatabase } from "../runtime/helpers.ts";
import { dischargePdf } from "./fixture.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let storage: ReturnType<typeof createObjectStorage>;
let userId: string;
let subjectId: string;
let caseId: string;
let actorId: string;
let documentId: string;
let proposalToken: string;
const secret = "document-integration-test-key-with-32-characters";
const storedKeys: string[] = [];

function service(id = userId) {
  return createDocumentService(database.db, id, {
    storage,
    encryptionSecret: secret,
    proposalSecret: secret,
  });
}
function runtime(user = userId, role: "subject" | "helper" = "subject"): RuntimeContext {
  return {
    caseId,
    subjectId,
    actorId,
    userId: user,
    sessionId: randomUUID(),
    actorRole: role,
    autonomyLevel: "L2",
    shareScope: { facts: true },
    sentenceIndex: 0,
  };
}
beforeAll(async () => {
  database = await isolatedDatabase();
  storage = createObjectStorage();
  ({ userId } = await identity(database.db));
  subjectId = randomUUID();
  caseId = randomUUID();
  actorId = randomUUID();
  await database.db.insert(subjects).values({
    id: subjectId,
    createdBy: userId,
    displayName: "Testperson",
    relationToUser: "self",
  });
  await database.db
    .insert(cases)
    .values({ id: caseId, subjectId, confirmedGoal: "Unterlagen organisieren" });
  await database.db
    .insert(caseActors)
    .values({ id: actorId, caseId, userId, role: "subject", shareScope: {} });
}, 30000);
afterAll(async () => {
  vi.restoreAllMocks();
  if (storage) {
    for (const key of storedKeys) await storage.delete(key);
    storage.close();
  }
  await database?.cleanup();
});

test("FR-D1 uploads the real discharge PDF to MinIO encrypted, stores positioned pages and serves original bytes", async () => {
  const bytes = await dischargePdf();
  const result = await service().upload(bytes, { subjectId });
  documentId = result.documentId;
  expect(result).toMatchObject({
    pageCount: 7,
    ocrStatus: "completed",
    mediaType: "application/pdf",
  });
  const [document] = await database.db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) throw new Error("Upload not stored");
  storedKeys.push(document.storageKey);
  const stored = await storage.get(document.storageKey);
  expect(stored.subarray(0, 5).toString()).not.toBe("%PDF-");
  expect((await service().read({ subjectId, documentId })).bytes).toEqual(Buffer.from(bytes));
  expect(document.pages).toHaveLength(7);
  expect(await service().listFacts({ subjectId })).toEqual([]);
});

test("FR-P3 extraction is a proposal only; confirmation is explicit, sourced and idempotent", async () => {
  vi.spyOn(extraction, "extractDocumentStatements").mockImplementation(async (pages) => {
    const page = pages[0];
    const line = page?.lines[0];
    if (!page || !line) throw new Error("Missing fixture text");
    return extraction.groundStatements(
      { statements: [{ type: "administrative_fact", page: page.page, quote: line.text }] },
      pages,
    );
  });
  const result = await service().extract({ subjectId, documentId });
  const proposal = result.proposals[0];
  if (!proposal) throw new Error("Missing proposal");
  proposalToken = proposal.proposalToken;
  expect(await service().listFacts({ subjectId })).toEqual([]);
  await expect(
    service().confirmFact({ proposalToken, confirmed: false as true }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  const first = await service().confirmFact({ proposalToken, confirmed: true });
  expect(first).toMatchObject({ confirmed: true, source: proposal.source, value: proposal.value });
  expect(await service().confirmFact({ proposalToken, confirmed: true })).toEqual(first);
  expect(await service().listFacts({ subjectId })).toHaveLength(1);
  expect((await service().extract({ subjectId, documentId })).proposals).toEqual([]);
  vi.restoreAllMocks();
});

test("FR-P1 context.queryFacts checks persisted subject and helper scope rather than stale runtime claims", async () => {
  const outsider = (await identity(database.db)).userId;
  const helperActorId = randomUUID();
  await database.db.insert(caseActors).values({
    id: helperActorId,
    caseId,
    userId: outsider,
    role: "helper",
    shareScope: { mode: "restricted", factTypes: ["documented_recommendation"] },
  });
  const query = contextTools({ allowStubs: false, db: database.db })["context.queryFacts"];
  if (!query) throw new Error("Missing query tool");
  const context = { ...runtime(outsider, "helper"), actorId: helperActorId };
  const input = { subjectId, factTypes: ["administrative_fact"] };
  expect(await query(input, context, { toolCallId: randomUUID(), messages: [], context })).toEqual(
    [],
  );
  await database.db
    .update(caseActors)
    .set({ shareScope: { mode: "restricted", factTypes: ["administrative_fact"] } })
    .where(and(eq(caseActors.caseId, caseId), eq(caseActors.userId, outsider)));
  expect(
    await query(input, context, { toolCallId: randomUUID(), messages: [], context }),
  ).toHaveLength(1);
  await database.db
    .update(caseActors)
    .set({ shareScope: {} })
    .where(and(eq(caseActors.caseId, caseId), eq(caseActors.userId, outsider)));
  expect(await query(input, context, { toolCallId: randomUUID(), messages: [], context })).toEqual(
    [],
  );
  await expect(service(outsider).extract({ subjectId, caseId, documentId })).rejects.toMatchObject({
    code: "access_denied",
  });
  await expect(
    service(outsider).confirmFact({ proposalToken, confirmed: true }),
  ).rejects.toMatchObject({ code: "invalid_proposal" });
  await expect(service(outsider).upload(await dischargePdf(), { subjectId })).rejects.toMatchObject(
    { code: "access_denied" },
  );
  await expect(
    query({ ...input, subjectId: randomUUID() }, context, {
      toolCallId: randomUUID(),
      messages: [],
      context,
    }),
  ).rejects.toThrow();
});

test("FR-D3 registered docs tool is real with stubs disabled and does not write facts", async () => {
  const provider = vi.spyOn(extraction, "extractDocumentStatements").mockResolvedValue([]);
  const execute = docsTools({ allowStubs: false, db: database.db })["docs.extractStatements"];
  if (!execute) throw new Error("Missing document tool");
  const context = runtime();
  expect(
    await execute({ documentId }, context, { toolCallId: randomUUID(), messages: [], context }),
  ).toEqual([]);
  expect(provider).toHaveBeenCalled();
  await database.db
    .update(documents)
    .set({ ocrStatus: "pending" })
    .where(eq(documents.id, documentId));
  provider.mockClear();
  await expect(service().extract({ subjectId, documentId })).rejects.toMatchObject({
    code: "document_not_ready",
  });
  expect(provider).not.toHaveBeenCalled();
  await database.db
    .update(documents)
    .set({ ocrStatus: "completed" })
    .where(eq(documents.id, documentId));
  vi.restoreAllMocks();
});

test("FR-D3 recommendation confirmation and edits preserve the original medical wording", async () => {
  const [document] = await database.db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) throw new Error("Missing document");
  const page = documentPagesSchema.parse(document.pages).find((page) => page.page === 5);
  const line = page?.lines.find((line) => line.text.startsWith("Empfehlung:"));
  if (!page || !line) throw new Error("Missing documented recommendation");
  const signed = signProposal(
    {
      userId,
      subjectId,
      documentId,
      documentHash: document.hash,
      statement: {
        type: "documented_recommendation",
        quote: line.text,
        page: page.page,
        bbox: line.bbox,
      },
    },
    secret,
  );
  await expect(
    service().confirmFact({
      proposalToken: signed.proposalToken,
      confirmed: true,
      value: "A paraphrase",
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  const fact = await service().confirmFact({
    proposalToken: signed.proposalToken,
    confirmed: true,
  });
  await expect(
    service().editFact({ subjectId, factId: fact.id, confirmed: true, value: "A paraphrase" }),
  ).rejects.toMatchObject({ code: "invalid_input" });
});

test("documents.checklist reads attachment requirements and acquisition sources from the real catalog", async () => {
  const folder = new URL("../../../knowledge/catalog/", import.meta.url);
  const names = (await readdir(folder)).filter((name) => name.endsWith(".yaml"));
  const catalogSchema = benefitRecordSchema.partial({ verified_at: true });
  let record: ReturnType<typeof catalogSchema.parse> | undefined;
  for (const name of names) {
    const parsed = catalogSchema.safeParse(parse(await readFile(new URL(name, folder), "utf8")));
    if (parsed.success && parsed.data.documents.some((document) => document.required)) {
      record = parsed.data;
      break;
    }
  }
  const attachment = record?.documents.find((document) => document.required);
  if (!record || !attachment) throw new Error("Missing sourced catalog requirements");
  await database.db.insert(benefits).values({
    key: record.id,
    title: record.name_de,
    category: record.area,
    record: JsonObjectSchema.parse(record),
  });
  const execute = documentTools({ db: database.db, allowStubs: false })["documents.checklist"];
  if (!execute) throw new Error("Missing checklist tool");
  const context = runtime();
  const input = { benefitId: record.id, subjectId };
  const options = { context, toolCallId: randomUUID(), messages: [] };
  expect(await execute(input, context, options)).toContainEqual({
    type: attachment.id,
    title: attachment.name_de,
    status: "missing",
    whereToObtain: attachment.obtain_from,
    sources: [{ url: attachment.source.url, quote: attachment.source.quote, asOf: record.as_of }],
  });
  await database.db
    .update(documents)
    .set({ type: attachment.id })
    .where(eq(documents.id, documentId));
  expect(await execute(input, context, options)).toContainEqual({
    type: attachment.id,
    title: attachment.name_de,
    status: "have",
    whereToObtain: attachment.obtain_from,
    sources: [{ url: attachment.source.url, quote: attachment.source.quote, asOf: record.as_of }],
  });
});

test("FR-P1 deleting a document cascades through its facts and derived facts and removes its original", async () => {
  const [fact] = await service().listFacts({ subjectId });
  if (!fact) throw new Error("Missing confirmed fact");
  const derivedId = randomUUID();
  await database.db.insert(facts).values({
    id: derivedId,
    subjectId,
    type: "administrative_fact",
    value: "Derived test value",
    sourceFactId: fact.id,
    source: { kind: "document", quote: "Derived test value" },
    confidence: 1,
    confirmed: true,
  });
  await service().deleteDocument({ subjectId, documentId });
  expect(await service().listFacts({ subjectId })).toEqual([]);
  expect(await database.db.select().from(facts).where(eq(facts.id, derivedId))).toEqual([]);
  const key = storedKeys.pop();
  if (!key) throw new Error("Missing storage key");
  await expect(storage.get(key)).rejects.toThrow();
});
