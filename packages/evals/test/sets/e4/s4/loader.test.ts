import { readdir, readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  CaseSchema,
  loadRubric,
  PersonaSpecSchema,
  RubricSchema,
  SourceSchema,
  SuiteSchema,
  scoreSchema,
} from "../../../../src/index.ts";

const directory = new URL("../../../../sets/e4/s4/", import.meta.url);
const repository = new URL("../../../../../../", import.meta.url);
const text = z.string().trim().min(1);
const sourceIds = z.array(text).min(1);
const claim = z.strictObject({ description: text, sourceIds });
const reference = claim.extend({ catalogRef: text.nullable() });
const document = claim.extend({ obtainFrom: text });
const TopicSchema = z.enum([
  "examinations",
  "vaccinations",
  "child_health",
  "movement",
  "nutrition",
  "family_counseling",
  "family_allowance",
  "childcare_allowance",
]);
const InputSchema = z.strictObject({
  openingUtterance: text,
  persona: PersonaSpecSchema,
  dimensions: z
    .array(
      z.enum([
        "standard",
        "simple",
        "dialect",
        "colloquial",
        "helper",
        "missing_information",
        "contradictory_information",
        "voice_captions",
      ]),
    )
    .min(1),
});
const ExpectedSchema = z.strictObject({
  goal: claim,
  benefits: z.array(reference.extend({ topic: TopicSchema })).length(8),
  offices: z.array(reference).min(3),
  documents: z.strictObject({
    scope: claim,
    required: z.array(document),
    conditional: z.array(document),
  }),
  forms: z.array(reference).min(1),
  questions: z.strictObject({
    baseline: z.literal("authored_next_step_lower_bound"),
    minimum: z.number().int().nonnegative(),
    requiredSlots: z.array(claim.extend({ fact: text })),
    countingRule: text,
    sourceIds,
  }),
  nextAction: claim,
  communication: claim.extend({
    language: z.enum(["de-AT", "en"]),
    simple: z.boolean(),
    voiceCaptions: z.boolean(),
  }),
  citations: claim,
  boundary: claim,
});
const ProvenanceSchema = z
  .array(
    SourceSchema.extend({
      id: text,
      locator: text,
      retrievedAt: z.iso.date(),
    }),
  )
  .min(1);

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, directory), "utf8"));
}

async function loadCases() {
  const cases = z.array(CaseSchema).parse(await readJson("cases.json"));
  return cases.map((item) => ({
    ...item,
    input: InputSchema.parse(item.input),
    expected: ExpectedSchema.parse(item.expected),
  }));
}

function referencedSources(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referencedSources);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "sourceIds" ? sourceIds.parse(child) : referencedSources(child),
  );
}

async function catalogReferences(category: string): Promise<string[]> {
  const root = new URL(`packages/knowledge/${category}/`, repository);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const references: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:json|ya?ml)$/u.test(entry.name)) continue;
    const contents = await readFile(`${entry.parentPath}/${entry.name}`, "utf8");
    const id = entry.name.endsWith(".json")
      ? z.object({ id: text }).parse(JSON.parse(contents)).id
      : /^id:\s*["']?([^"'\r\n]+)["']?\s*$/mu.exec(contents)?.[1];
    if (id) references.push(`ref:${category}/${id}`);
  }
  return references;
}

test("AC1 validates twenty unique harness cases and complete persona specifications", async () => {
  const suite = SuiteSchema.parse(await readJson("suite.json"));
  expect(suite).toMatchObject({
    id: "E4",
    minimumSetSize: 300,
    gate: { kind: "informational", metric: "passRate", threshold: 0.9 },
  });
  const cases = await loadCases();
  expect(cases).toHaveLength(20);
  expect(new Set(cases.map((item) => item.id)).size).toBe(20);
  expect(new Set(cases.map((item) => item.input.openingUtterance)).size).toBe(20);
  for (const item of cases) {
    expect(item.kind).toBe("synthetic");
    expect(item.tags).toContain("nightly");
    expect(item.tags).toContain("weekly");
    expect(item.source).toBeDefined();
    expect(item.input.persona.facts.openingUtterance).toBe(item.input.openingUtterance);
    expect(item.input.persona.facts.childAgeMonths).toBeTypeOf("number");
    expect(item.input.persona.goal).toContain("overview");
    expect(item.input.persona.language).toBe(item.expected.communication.language);
    expect(item.input.persona.style).toContain("openingUtterance");
    // Strict suite schemas catch unknown/misspelled expectation and input fields.
    expect(item.input).toEqual(InputSchema.parse(item.input));
    expect(item.expected).toEqual(ExpectedSchema.parse(item.expected));
  }
});

test("AC1 covers both languages and every requested interaction dimension", async () => {
  const cases = await loadCases();
  for (const language of ["de-AT", "en"]) {
    const localized = cases.filter((item) => item.input.persona.language === language);
    expect(localized.length).toBeGreaterThanOrEqual(5);
    for (const dimension of [
      "simple",
      "helper",
      "missing_information",
      "contradictory_information",
      "voice_captions",
    ] as const) {
      expect(localized.some((item) => item.input.dimensions.includes(dimension))).toBe(true);
    }
  }
  for (const dimension of InputSchema.shape.dimensions.element.options) {
    const covered = cases.filter((item) => item.input.dimensions.includes(dimension));
    expect(covered.length, dimension).toBeGreaterThan(0);
    expect(
      covered.some((item) => item.tags.includes("pr")),
      dimension,
    ).toBe(true);
  }
  expect(new Set(cases.map((item) => item.input.persona.region)).size).toBeGreaterThanOrEqual(5);
  expect(new Set(cases.map((item) => item.input.persona.carrier)).size).toBeGreaterThanOrEqual(3);
});

test("AC1 aligns variant facts and requested communication with the expected next step", async () => {
  const cases = await loadCases();
  for (const item of cases) {
    const dimensions = item.input.dimensions;
    expect(item.expected.communication.simple).toBe(dimensions.includes("simple"));
    expect(item.expected.communication.voiceCaptions).toBe(dimensions.includes("voice_captions"));
    if (dimensions.includes("helper")) {
      expect(item.input.persona.facts.actorRole).not.toBe("parent");
      expect(item.expected.goal.description).toMatch(/helper/iu);
    }
    if (dimensions.includes("missing_information")) {
      const withheld = z.array(text).min(1).parse(item.input.persona.facts.withheldUntilAsked);
      const slots = item.expected.questions.requiredSlots.map((slot) => slot.fact);
      for (const fact of withheld) {
        expect(slots).toContain(fact);
        expect(item.input.persona.facts).toHaveProperty(fact);
      }
    }
    if (dimensions.includes("contradictory_information")) {
      const corrections = z
        .record(text, z.json())
        .parse(item.input.persona.facts.correctionWhenAsked);
      expect(Object.keys(corrections).length).toBeGreaterThan(0);
      for (const [fact, value] of Object.entries(corrections)) {
        expect(item.expected.questions.requiredSlots.map((slot) => slot.fact)).toContain(fact);
        expect(item.input.persona.facts[fact]).toEqual(value);
      }
      expect(item.expected.nextAction.description).toMatch(/clarif/iu);
    }
  }
});

test("AC1 grounds every expected outcome and resolves existing catalog references", async () => {
  const sources = ProvenanceSchema.parse(await readJson("sources.json"));
  const byId = new Map(sources.map((source) => [source.id, source]));
  expect(byId.size).toBe(sources.length);
  const available = (
    await Promise.all(["catalog", "offices", "forms"].map(catalogReferences))
  ).flat();
  const used = new Set<string>();
  for (const source of sources) {
    const url = new URL(source.uri);
    if (url.protocol === "file:") {
      expect(source.uri).toMatch(/^file:\/\/\/repo\/docs\/prd\//u);
      const contents = await readFile(
        new URL(url.pathname.replace(/^\/repo\//u, ""), repository),
        "utf8",
      );
      expect(contents).toContain(source.passage);
    } else {
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toMatch(
        /(?:^|\.)(?:gesundheit\.gv\.at|oesterreich\.gv\.at|sozialversicherung\.gv\.at|familienberatung\.gv\.at|wien\.gv\.at)$/u,
      );
    }
  }
  for (const item of await loadCases()) {
    expect(item.source).toEqual({
      uri: byId.get("scenario")?.uri,
      passage: byId.get("scenario")?.passage,
    });
    for (const id of referencedSources(item.expected)) {
      expect(byId.has(id), `${item.id}: ${id}`).toBe(true);
      used.add(id);
    }
    for (const outcome of [
      ...item.expected.benefits,
      ...item.expected.offices,
      ...item.expected.forms,
    ]) {
      if (outcome.catalogRef !== null) expect(available).toContain(outcome.catalogRef);
    }
    expect(new Set(item.expected.benefits.map((benefit) => benefit.topic)).size).toBe(8);
    const { questions } = item.expected;
    expect(questions.minimum).toBe(questions.requiredSlots.length);
    expect(new Set(questions.requiredSlots.map((slot) => slot.fact)).size).toBe(questions.minimum);
    expect(questions.countingRule).toContain("goal confirmation");
  }
  expect([...used].sort()).toEqual([...byId.keys()].sort());
});

test("AC2 validates the versioned rubric with all nine anchored harness criteria", async () => {
  const rubric = await loadRubric(new URL("rubric.v1.yaml", directory));
  expect(RubricSchema.parse(rubric)).toEqual(rubric);
  expect(rubric.version).toBe("1");
  expect(rubric.criteria.map((criterion) => criterion.id).sort()).toEqual([
    "benefits",
    "boundary",
    "citations",
    "documents",
    "goal_confirmed",
    "next_action",
    "office",
    "question_efficiency",
    "tone_language",
  ]);
  for (const criterion of rubric.criteria) {
    expect(Object.keys(criterion.anchors)).toHaveLength(criterion.scale === "binary" ? 2 : 3);
    for (const anchor of Object.values(criterion.anchors))
      expect(anchor.length).toBeGreaterThan(40);
  }
  const valid = Object.fromEntries(
    rubric.criteria.map((criterion) => [
      criterion.id,
      { score: 1, rationale: "Evidence in the administrative transcript." },
    ]),
  );
  expect(scoreSchema(rubric).safeParse(valid).success).toBe(true);
  expect(
    scoreSchema(rubric).safeParse({ ...valid, invented: { score: 1, rationale: "Unsupported." } })
      .success,
  ).toBe(false);
});

test("AC3 keeps expected answers within administrative navigation", async () => {
  // Supplement to manual review: these guards cannot prove the absence of medical advice.
  for (const item of await loadCases()) {
    expect(item.expected.boundary.sourceIds).toContain("medical_boundary");
    expect(item.expected.boundary.description).toContain("No diagnosis");
    const answers = JSON.stringify([
      item.expected.benefits,
      item.expected.documents,
      item.expected.nextAction,
    ]);
    expect(answers).not.toMatch(
      /\b(?:take|administer|prescribe)\s+\d|\b\d+\s*(?:mg|ml)\b|your child (?:needs|has a disease|is at risk)/iu,
    );
  }
  const cases = await loadCases();
  expect(cases.some((item) => item.expected.documents.required.length > 0)).toBe(true);
  expect(cases.some((item) => item.expected.documents.required.length === 0)).toBe(true);
});
