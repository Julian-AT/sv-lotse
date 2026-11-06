import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  CaseSchema,
  loadRubric,
  PersonaSpecSchema,
  RubricSchema,
  SourceSchema,
  SuiteSchema,
  selectCases,
} from "../../../../src/index.ts";

const directory = new URL("../../../../sets/e4/s3/", import.meta.url);
const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
const text = z.string().trim().min(1);
const sourceIds = z.array(text).min(1);
const sourced = z.strictObject({ description: text, sources: sourceIds });
const reference = z.strictObject({
  collection: z.enum(["catalog", "offices", "forms"]),
  id: text,
  path: text,
});
const outcomeKeys = [
  "document_import",
  "quote_extraction",
  "rehabilitation",
  "office",
  "live_form",
  "document_checklist",
  "facility_search",
  "appointment_preparation",
  "fee_exemption",
  "eko_check",
  "additional_support",
  "hospital_handoff",
] as const;
const inputSchema = z.strictObject({
  utterance: text,
  persona: PersonaSpecSchema,
  interaction: z.strictObject({
    language: z.enum(["de-AT", "en"]),
    register: z.enum(["standard", "simple", "dialect", "colloquial"]),
    role: z.enum(["subject", "helper"]),
    channel: z.enum(["text", "voice_captions"]),
    availablePages: z.array(z.number().int().min(1).max(7)).min(1),
  }),
  document: z.strictObject({
    origin: z.literal("svbox"),
    path: text,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    pageCount: z.literal(7),
  }),
});
const expectedSchema = z.strictObject({
  goal: sourced,
  outcomes: z.array(sourced.extend({ key: z.enum(outcomeKeys), references: z.array(reference) })),
  questions: z.strictObject({
    baseline: z.literal("runtime_process_engine"),
    mustClarify: z.array(text),
    doNotReask: z.array(text),
    sources: sourceIds,
  }),
  nextAction: sourced,
  adaptation: sourced,
  endState: sourced,
  boundary: sourced,
});
const sourceSchema = SourceSchema.extend({
  id: text,
  path: text,
  page: z.number().int().positive().optional(),
});

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, directory), "utf8")) as unknown;
}

async function loadCases() {
  return z
    .array(CaseSchema)
    .parse(await readJson("cases.json"))
    .map((item) => ({
      ...item,
      input: inputSchema.parse(item.input),
      expected: expectedSchema.parse(item.expected),
    }));
}

async function repositoryFiles(path: string): Promise<string[]> {
  const entries = await readdir(resolve(repository, path), { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await repositoryFiles(child)));
    else if (/\.(?:json|ya?ml)$/u.test(entry.name)) result.push(child);
  }
  return result;
}

test("AC1 loads 20 distinct source-backed cases and every harness persona", async () => {
  const suite = SuiteSchema.parse(await readJson("suite.json"));
  expect(suite).toMatchObject({
    id: "E4",
    minimumSetSize: 20,
    gate: { kind: "informational", metric: "passRate", threshold: 0.9 },
  });
  const cases = await loadCases();
  expect(cases).toHaveLength(20);
  expect(new Set(cases.map((item) => item.id)).size).toBe(20);
  expect(new Set(cases.map((item) => item.input.utterance)).size).toBe(20);
  for (const item of cases) {
    expect(item.kind).toBe("gold");
    expect(item.tags).toContain("synthetic-persona");
    expect(item.source).toBeDefined();
    expect(item.input.persona.language).toBe(item.input.interaction.language);
    expect(item.input.persona.facts.openingUtterance).toBe(item.input.utterance);
    expect(item.expected.outcomes.map((outcome) => outcome.key).sort()).toEqual(
      [...outcomeKeys].sort(),
    );
    expect(item.input.persona.goal).toBe(item.expected.goal.description);
  }
});

test("AC1 covers both launch languages, registers, helpers, unknowns, conflicts and voice paths", async () => {
  const cases = await loadCases();
  for (const language of inputSchema.shape.interaction.shape.language.options) {
    const matching = cases.filter((item) => item.input.interaction.language === language);
    expect(matching.length).toBeGreaterThanOrEqual(4);
    for (const dimension of ["simple", "colloquial", "helper", "voice_captions"]) {
      expect(
        matching.some((item) => item.tags.includes(dimension)),
        `${language}: ${dimension}`,
      ).toBe(true);
    }
  }
  for (const dimension of ["dialect", "missing_information", "contradictory_information"]) {
    expect(cases.filter((item) => item.tags.includes(dimension)).length).toBeGreaterThanOrEqual(2);
  }
  for (const item of cases) {
    for (const dimension of Object.values(item.input.interaction)) {
      if (typeof dimension === "string") expect(item.tags).toContain(dimension);
    }
    if (
      item.tags.includes("missing_information") ||
      item.tags.includes("contradictory_information")
    ) {
      expect(item.expected.questions.mustClarify.length).toBeGreaterThan(0);
    }
    for (const fact of item.expected.questions.mustClarify) {
      expect(item.expected.questions.doNotReask).not.toContain(fact);
    }
  }
  const selected = selectCases(cases, { subset: "pr" });
  expect(selected.length).toBeGreaterThanOrEqual(6);
  for (const dimension of [
    "de-AT",
    "en",
    "helper",
    "voice_captions",
    "contradictory_information",
  ]) {
    expect(
      selected.some((item) => item.tags.includes(dimension)),
      dimension,
    ).toBe(true);
  }
  expect(selectCases(cases, { subset: "nightly" })).toHaveLength(20);
  expect(selectCases(cases, { subset: "weekly" })).toHaveLength(20);
});

test("AC2 loads rubric v1 with all nine written scenario anchors through the eval harness", async () => {
  const rubric = await loadRubric(new URL("rubric.v1.yaml", directory));
  expect(RubricSchema.parse(rubric)).toEqual(rubric);
  expect(rubric.version).toBe("1");
  expect(rubric.criteria.map((criterion) => criterion.id).sort()).toEqual(
    [
      "goal_confirmed",
      "benefits",
      "office",
      "documents",
      "question_efficiency",
      "next_action",
      "tone_language",
      "citations",
      "boundary",
    ].sort(),
  );
  for (const criterion of rubric.criteria) {
    expect(Object.keys(criterion.anchors)).toEqual(
      criterion.scale === "binary" ? ["0", "1"] : ["0", "1", "2"],
    );
    for (const anchor of Object.values(criterion.anchors))
      expect(anchor.length).toBeGreaterThan(40);
  }
});

test("AC1 resolves a source for every expectation and uses existing catalog references", async () => {
  const sources = z.array(sourceSchema).parse(await readJson("sources.json"));
  const byId = new Map(sources.map((source) => [source.id, source]));
  expect(byId.size).toBe(sources.length);
  const cases = await loadCases();
  for (const item of cases) {
    const expected = item.expected;
    const groups = [
      expected.goal,
      ...expected.outcomes,
      expected.questions,
      expected.nextAction,
      expected.adaptation,
      expected.endState,
      expected.boundary,
    ];
    for (const group of groups) {
      for (const id of group.sources) expect(byId.has(id), `${item.id}: ${id}`).toBe(true);
    }
    for (const outcome of expected.outcomes) {
      for (const ref of outcome.references) {
        expect(ref.path.startsWith(`packages/knowledge/${ref.collection}/`)).toBe(true);
        const record = await readFile(resolve(repository, ref.path), "utf8");
        expect(record).toMatch(new RegExp(`(?:"id"\\s*:|^id:)\\s*"${ref.id}"`, "mu"));
        expect(outcome.sources.some((id) => byId.get(id)?.path === ref.path)).toBe(true);
      }
    }
    const coverage = expected.outcomes.find((outcome) => outcome.key === "eko_check");
    if (!coverage) throw new Error("Missing administrative coverage outcome");
    const medicines = coverage.sources
      .map((id) => byId.get(id))
      .filter((source) => source?.page === 3 && source.path === item.input.document.path);
    expect(medicines).toHaveLength(4);
    for (const medicine of medicines) {
      if (!medicine) throw new Error("Missing medicine source");
      expect(coverage.description).toContain(medicine.passage);
    }
    expect(
      sources.some(
        (source) => source.uri === item.source?.uri && source.passage === item.source?.passage,
      ),
    ).toBe(true);
  }
  // An absent catalog cannot justify invented IDs; future catalog additions remain valid.
  for (const collection of ["catalog", "forms"]) {
    if ((await repositoryFiles(`packages/knowledge/${collection}`)).length === 0) {
      for (const item of cases) {
        expect(
          item.expected.outcomes
            .flatMap((outcome) => outcome.references)
            .filter((ref) => ref.collection === collection),
        ).toEqual([]);
      }
    }
  }
  for (const source of sources.filter((entry) => entry.uri.startsWith("file:"))) {
    expect(await readFile(resolve(repository, source.path), "utf8"), source.id).toContain(
      source.passage,
    );
  }
});

test("AC1 pins the real discharge letter and verifies every PDF source passage", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const sources = z.array(sourceSchema).parse(await readJson("sources.json"));
  const cases = await loadCases();
  const documents = new Map(cases.map((item) => [item.input.document.path, item.input.document]));
  expect(documents.size).toBe(1);
  const svbox = resolve(repository, process.env.SVBOX_DIR ?? "data/svbox");
  for (const source of sources.filter((entry) => entry.uri.startsWith("svbox:"))) {
    const bytes = await readFile(resolve(svbox, source.path));
    const document = documents.get(source.path);
    if (document) {
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(document.sha256);
    }
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
    try {
      const pdf = await loading.promise;
      if (document) expect(pdf.numPages).toBe(document.pageCount);
      if (source.page === undefined) throw new Error("PDF source requires a page");
      const content = await (await pdf.getPage(source.page)).getTextContent();
      const textLayer = content.items
        .filter((item) => "str" in item)
        .map((item) => item.str)
        .join(" ");
      const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
      expect(normalize(textLayer), source.id).toContain(normalize(source.passage));
    } finally {
      await loading.destroy();
    }
  }
});

test("AC3 records manual medical-boundary review and keeps every expected answer administrative", async () => {
  // A regression guard supplements the documented manual review; it is not a medical classifier.
  const prohibited =
    /(?:you should (?:take|stop)|increase (?:your|the) dose|because of your diagnosis|aufgrund Ihrer Diagnose|nehmen Sie .* täglich)/iu;
  for (const item of await loadCases()) {
    expect(JSON.stringify(item.expected)).not.toMatch(prohibited);
    expect(item.expected.boundary.description).toContain("verbatim");
    expect(item.expected.boundary.description).toContain("doctor or pharmacist");
  }
  const readme = await readFile(new URL("README.md", directory), "utf8");
  expect(readme).toContain("Manual medical-boundary review");
});
