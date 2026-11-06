import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {
  benefits,
  caseActors,
  cases,
  documents,
  facilities,
  facts,
  offices,
  subjects,
  users,
} from "@lotse/db/schema";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { directoryBenefitSchema, directoryRecordSchema } from "../../src/directory/schema.ts";
import { contracts, type ToolName } from "../../src/tools/contracts/index.ts";
import { buildTools } from "../../src/tools/registry.ts";
import { isolatedDatabase } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let context: RuntimeContext;
let benefitId: string;
let nameFact: z.infer<(typeof contracts)["appointment.prepare"]["input"]>["subjectFacts"][number];
const window = { from: "2026-11-09T09:00:00+01:00", to: "2026-11-09T10:00:00+01:00" };

async function records(
  kind: string,
): Promise<Record<string, z.infer<ReturnType<typeof z.json>>>[]> {
  const root = new URL(`../../../knowledge/${kind}/`, import.meta.url);
  const files = await readdir(root, { recursive: true });
  return Promise.all(
    files
      .filter((file) => /\.(json|ya?ml)$/.test(file))
      .map(async (file) => {
        const text = await readFile(new URL(file, root), "utf8");
        return z
          .record(z.string(), z.json())
          .parse(file.endsWith(".json") ? JSON.parse(text) : parse(text));
      }),
  );
}

beforeAll(async () => {
  database = await isolatedDatabase();
  for (const record of await records("catalog")) {
    const benefit = directoryBenefitSchema.parse(record);
    await database.db
      .insert(benefits)
      .values({ key: benefit.id, title: benefit.name_de, category: benefit.area, record });
    if (benefit.office_rules.some((rule) => rule.when.includes("contact_carrier")))
      benefitId = benefit.id;
  }
  for (const record of await records("offices")) {
    const office = directoryRecordSchema.parse(record);
    await database.db.insert(offices).values({ key: office.id, title: office.name_de, record });
  }
  for (const record of await records("facilities")) {
    const facility = directoryRecordSchema.parse(record);
    await database.db
      .insert(facilities)
      .values({ key: facility.id, title: facility.name_de, type: facility.type ?? "", record });
  }
  const userId = randomUUID();
  const subjectId = randomUUID();
  const caseId = randomUUID();
  const actorId = randomUUID();
  const documentId = randomUUID();
  await database.db.insert(users).values({ id: userId });
  await database.db.insert(subjects).values({
    id: subjectId,
    displayName: "Testperson",
    relationToUser: "self",
    createdBy: userId,
  });
  await database.db
    .insert(cases)
    .values({ id: caseId, subjectId, confirmedGoal: "Kontakt und Unterlagen klären" });
  await database.db
    .insert(caseActors)
    .values({ id: actorId, caseId, userId, role: "subject", shareScope: {} });
  await database.db.insert(documents).values({
    id: documentId,
    subjectId,
    type: "administrative",
    storageKey: randomUUID(),
    hash: "test",
    originClient: "web",
  });
  nameFact = {
    id: randomUUID(),
    subjectId,
    type: "name.full",
    value: "Testperson",
    source: { kind: "document", documentId, page: 1, quote: "Testperson" },
    confidence: 1,
    confirmed: true,
  };
  // Personal facts are synthetic test-only fixtures; directory records are real sourced catalog data.
  await database.db.insert(facts).values({
    ...nameFact,
    documentId,
    source: z.record(z.string(), z.json()).parse(nameFact.source),
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
afterAll(async () => {
  await database?.cleanup();
});
async function execute(name: ToolName, input: unknown, runtime = context): Promise<unknown> {
  const implementation = buildTools({ db: database.db, allowStubs: false })[name].execute;
  if (!implementation) throw new Error("Missing tool");
  return implementation(input, { toolCallId: randomUUID(), messages: [], context: runtime });
}
async function options() {
  return contracts["appointment.search"].output.parse(
    await execute("appointment.search", {
      type: "rehabilitation",
      preferences: {
        near: "8010",
        timeWindow: window,
        maxDistanceKm: 60,
        language: "de",
        accessibility: ["step-free"],
      },
    }),
  );
}

test("FR-O1 resolves the catalog-selected carrier office from real Postgres", async () => {
  const office = contracts["office.resolve"].output.parse(
    await execute("office.resolve", {
      benefitId,
      carrier: "pva",
      subjectStatus: "employed",
      region: "Steiermark",
    }),
  );
  expect(office.address.city).toBe("Graz");
  expect(office.channels.phone).toBeTruthy();
  expect(office.sources.length).toBeGreaterThan(0);
  await expect(
    execute("office.resolve", {
      benefitId,
      carrier: "pva",
      subjectStatus: "pensioner",
      region: "not-a-region",
    }),
  ).rejects.toThrow("OFFICE_CONTEXT_REQUIRED");
});
test("FR-O2 returns sourced map coordinates and postcode distances for Styria and Vienna", async () => {
  for (const near of ["8010", "1010"]) {
    const results = contracts["facility.search"].output.parse(
      await execute("facility.search", { type: "rehabilitation", near, radiusKm: 60, filters: {} }),
    );
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.location).toBeDefined();
      expect(result.distanceKm).toBeLessThanOrEqual(60);
      expect(result.sources.length).toBeGreaterThan(0);
    }
  }
  const care = contracts["facility.search"].output.parse(
    await execute("facility.search", {
      type: "care_advice",
      near: "1030",
      radiusKm: 20,
      filters: {},
    }),
  );
  expect(care.length).toBeGreaterThan(0);
});
test("FR-O5 returns contact channels with true source retrieval dates and unverified access preferences", async () => {
  const results = await options();
  expect(results.length).toBeGreaterThan(0);
  for (const option of results) {
    expect(option.unverifiedPreferences).toContain("accessibility");
    expect(option.distanceKm).toBeLessThanOrEqual(60);
    expect(option.retrievedAt.startsWith("2026-11-06")).toBe(true);
    expect(option.notice).toContain("kein bestätigter freier Termin");
  }
});
test("FR-O5 also reads and prepares catalog channels without inventing facility details", async () => {
  const [benefit] = await database.db.select().from(benefits).limit(1);
  const [facility] = await database.db.select().from(facilities).limit(1);
  if (!benefit || !facility) throw new Error("Missing real source records");
  const contact = directoryRecordSchema.parse(facility.record);
  if (!contact.phone) throw new Error("Missing real contact number");
  // The current catalog has no reviewed appointment channels. This test-only
  // catalog clone uses a real provider contact to exercise that transport path.
  const key = "test-catalog-channels";
  const record = z.record(z.string(), z.json()).parse({
    ...benefit.record,
    id: key,
    sources: contact.sources,
    as_of: contact.as_of,
    appointment_channels: [{ kind: "phone", number: contact.phone, verified_at: contact.as_of }],
  });
  await database.db
    .insert(benefits)
    .values({ key, title: benefit.title, category: benefit.category, record });
  const result = contracts["appointment.search"].output.parse(
    await execute("appointment.search", {
      benefitId: key,
      facilityIds: [],
      preferences: { timeWindow: window, maxDistanceKm: 10, language: "de", accessibility: [] },
    }),
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.channels.phone).toBe(contact.phone);
  expect(result[0]?.distanceKm).toBeUndefined();
  expect(result[0]?.unverifiedPreferences).toContain("distance");
  const prepared = contracts["appointment.prepare"].output.parse(
    await execute("appointment.prepare", {
      caseId: context.caseId,
      option: result[0],
      subjectFacts: [],
    }),
  );
  expect(prepared.callSheet).toContain(contact.phone);
});
test("FR-O3 revalidates contact details and persisted facts before preparing unsent drafts and a hold", async () => {
  const option = (await options())[0];
  if (!option) throw new Error("Missing option");
  const input = {
    caseId: context.caseId,
    option: { ...option, channels: { email: "forged@example.org" } },
    subjectFacts: [{ ...nameFact, value: "forged name" }],
  };
  const result = contracts["appointment.prepare"].output.parse(
    await execute("appointment.prepare", input),
  );
  expect(result.callSheet).toContain("Testperson");
  expect(result.callSheet).not.toContain("forged");
  expect(result.emailDraft).not.toContain("forged");
  expect(result.ics).toContain("STATUS:TENTATIVE");
  expect(result.bookingValues).toEqual([]);
  const rehearsal = contracts["appointment.rehearse"].output.parse(
    await execute("appointment.rehearse", input),
  );
  expect(rehearsal.script.length).toBeGreaterThan(2);
  expect(rehearsal.callSheet).toBe(result.callSheet);
});
test("FR-O3 rejects other cases, foreign facts, forged options and restricted helper facts", async () => {
  const option = (await options())[0];
  if (!option) throw new Error("Missing option");
  const input = { caseId: context.caseId, option, subjectFacts: [nameFact] };
  await expect(execute("appointment.prepare", { ...input, caseId: randomUUID() })).rejects.toThrow(
    "CASE_ACCESS_DENIED",
  );
  await expect(
    execute("appointment.prepare", {
      ...input,
      subjectFacts: [{ ...nameFact, subjectId: randomUUID() }],
    }),
  ).rejects.toThrow("FACT_ACCESS_DENIED");
  await expect(
    execute("appointment.prepare", { ...input, option: { ...option, id: "directory:absent:0" } }),
  ).rejects.toThrow("APPOINTMENT_NOT_FOUND");
  await expect(
    execute("appointment.prepare", input, {
      ...context,
      actorRole: "helper",
      shareScope: { facts: [] },
    }),
  ).rejects.toThrow("FACT_ACCESS_DENIED");
});

test("FR-O5 returns the sourced nationwide advice channel without inventing a map location", async () => {
  const rows = await database.db.select().from(facilities);
  const advice = rows
    .map((row) => directoryRecordSchema.parse(row.record))
    .find((record) => record.remote);
  if (!advice) throw new Error("Missing sourced remote contact");
  for (const near of ["1010", "8010", undefined]) {
    const result = contracts["appointment.search"].output.parse(
      await execute("appointment.search", {
        type: advice.type,
        preferences: {
          ...(near ? { near } : {}),
          timeWindow: window,
          maxDistanceKm: 1,
          language: "de",
          accessibility: [],
        },
      }),
    );
    const match = result.find((option) => option.facilityId === advice.id);
    expect(match?.channels.phone).toBe(advice.phone);
    expect(match?.sources.length).toBeGreaterThan(0);
    expect(match?.retrievedAt).toBe(advice.sources[0]?.retrieved_at);
    expect(match?.distanceKm).toBeUndefined();
    expect(match?.location).toBeUndefined();
    const prepared = contracts["appointment.rehearse"].output.parse(
      await execute("appointment.rehearse", {
        caseId: context.caseId,
        option: match,
        subjectFacts: [],
      }),
    );
    expect(prepared.callSheet).toContain(advice.phone);
    expect(prepared.script.some((line) => line.role === "office")).toBe(true);
  }
  const onlyPhysical = await options();
  expect(onlyPhysical.some((option) => option.facilityId === advice.id)).toBe(false);
});
