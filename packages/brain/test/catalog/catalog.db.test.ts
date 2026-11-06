import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { documents, facts, subjects, users } from "@lotse/db/schema";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { contracts } from "../../src/tools/contracts/index.ts";
import { implementations } from "../../src/tools/impl/catalog/index.ts";
import { isolatedDatabase } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let tools: ReturnType<typeof implementations>;
const subjectId = randomUUID();
const otherSubjectId = randomUUID();
const documentId = randomUUID();
const otherDocumentId = randomUUID();
const userId = randomUUID();
const context: RuntimeContext = {
  subjectId,
  userId,
  actorId: randomUUID(),
  caseId: randomUUID(),
  sessionId: randomUUID(),
  actorRole: "subject",
  autonomyLevel: "L1",
  shareScope: {},
  sentenceIndex: 0,
};
const options = { toolCallId: "catalog-db", messages: [], context };

beforeAll(async () => {
  database = await isolatedDatabase();
  const cli = fileURLToPath(new URL("../../../knowledge/src/loader/cli.ts", import.meta.url));
  const { stdout } = await promisify(execFile)("bun", [cli], {
    env: { ...process.env, DATABASE_URL: database.config.DATABASE_URL },
  });
  expect(stdout).toContain("Catalog loaded.");
  tools = implementations({ allowStubs: false, db: database.db });
  await database.db.insert(users).values({ id: userId });
  await database.db.insert(subjects).values([
    { id: subjectId, displayName: "Owner fixture", relationToUser: "self", createdBy: userId },
    {
      id: otherSubjectId,
      displayName: "Other fixture",
      relationToUser: "relative",
      createdBy: userId,
    },
  ]);
  await database.db.insert(documents).values([
    {
      id: documentId,
      subjectId,
      type: "vaccination_pass",
      storageKey: "test/owner",
      hash: "owner",
      originClient: "web",
    },
    {
      id: otherDocumentId,
      subjectId: otherSubjectId,
      type: "vaccination_pass",
      storageKey: "test/other",
      hash: "other",
      originClient: "web",
    },
  ]);
  // Test-only examples derived from the real E12 vaccination_record shape exercise confirmation and ownership edges.
  await database.db.insert(facts).values([
    {
      subjectId,
      type: "vaccination_record",
      value: "Recorded",
      documentId,
      source: { kind: "document", documentId, page: 2, quote: "Confirmed imported entry" },
      confirmed: true,
      confidence: 1,
    },
    {
      subjectId,
      type: "vaccination_record",
      value: "Unconfirmed",
      documentId,
      source: { kind: "document", documentId, page: 1, quote: "Unconfirmed imported entry" },
      confirmed: false,
      confidence: 1,
    },
    {
      subjectId: otherSubjectId,
      type: "vaccination_record",
      value: "Other",
      documentId: otherDocumentId,
      source: {
        kind: "document",
        documentId: otherDocumentId,
        page: 1,
        quote: "Other subject private entry",
      },
      confirmed: true,
      confidence: 1,
    },
    {
      subjectId,
      type: "vaccination_record",
      value: "Wrong document",
      documentId: otherDocumentId,
      source: {
        kind: "document",
        documentId: otherDocumentId,
        page: 1,
        quote: "Cross-subject document entry",
      },
      confirmed: true,
      confidence: 1,
    },
  ]);
}, 30000);

afterAll(async () => {
  if (database) await database.cleanup();
});

async function find(actorContext = context) {
  const result = await tools["catalog.findBenefits"]?.(
    { lifeSituation: "prevention", goalText: "Angebote", subject: {} },
    actorContext,
    options,
  );
  return contracts["catalog.findBenefits"].output.parse(result);
}

test("FR-G5 loads care, prevention and family bundles and returns sourced live catalog records", async () => {
  for (const lifeSituation of ["care", "prevention", "family-with-child"]) {
    const raw = await tools["catalog.findBenefits"]?.(
      { lifeSituation, goalText: "Angebote", subject: {} },
      context,
      options,
    );
    const results = contracts["catalog.findBenefits"].output.parse(raw);
    expect(results.length).toBeGreaterThan(4);
    for (const result of results) expect(result.sources.length).toBeGreaterThan(0);
  }
  const rows = await find();
  expect(rows.some((row) => row.description.includes("Sozialversicherung"))).toBe(true);
  expect(rows.some((row) => row.description.includes("außerhalb der Sozialversicherung"))).toBe(
    true,
  );
  const stored = await tools["catalog.getBenefit"]?.(
    { benefitId: "praevention-vorsorgeuntersuchung" },
    context,
    options,
  );
  expect(contracts["catalog.getBenefit"].output.parse(stored).target_group?.age_min).toBe(18);
  await expect(
    tools["catalog.getBenefit"]?.({ benefitId: "absent" }, context, options),
  ).rejects.toThrow("CATALOG_BENEFIT_NOT_FOUND");
});

test("FR-G6 returns only confirmed vaccination quotations from the authenticated subject's documents", async () => {
  const rows = await find();
  const text = JSON.stringify(rows);
  expect(text).toContain("Confirmed imported entry");
  expect(text).toContain(`document:${documentId}#page=2`);
  expect(text).not.toContain("Unconfirmed imported entry");
  expect(text).not.toContain("Other subject private entry");
  expect(text).not.toContain("Cross-subject document entry");
});

test("FR-G6 respects helper fact scopes before constructing any vaccination description", async () => {
  const denied = await find({ ...context, actorRole: "helper", shareScope: { facts: ["age"] } });
  expect(JSON.stringify(denied)).not.toContain("Confirmed imported entry");
  expect(JSON.stringify(denied)).toContain("keine bestätigten Impfeinträge");
  const allowed = await find({
    ...context,
    actorRole: "helper",
    shareScope: { facts: ["vaccination_record"] },
  });
  expect(JSON.stringify(allowed)).toContain("Confirmed imported entry");
});
