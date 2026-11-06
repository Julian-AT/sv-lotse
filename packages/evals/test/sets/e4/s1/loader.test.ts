import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  CaseSchema,
  loadRubric,
  PersonaSpecSchema,
  RubricSchema,
  SourceSchema,
  SuiteSchema,
} from "../../../../src/index.ts";

const root = new URL("../../../../sets/e4/s1/", import.meta.url);
const repository = new URL("../../../../../", root);
const text = z.string().trim().min(1);
const references = z.array(text).min(1);
const claim = { description: text, sources: references };
const catalogReference = z
  .strictObject({ kind: z.enum(["benefit", "office", "form"]), id: text, path: text })
  .nullable();
const documentedQuote = z.strictObject({
  text,
  page: z.number().int().positive(),
  sources: references,
});
const InputSchema = z.strictObject({
  opening: text,
  persona: PersonaSpecSchema,
  dimensions: z.strictObject({
    register: z.enum(["standard", "simple", "dialect", "colloquial"]),
    information: z.enum(["provided", "missing", "contradictory"]),
    channel: z.enum(["text", "voice_captions"]),
  }),
  initiallyKnownSlots: z.array(text),
  documents: z.array(documentedQuote),
});
const ExpectedSchema = z.strictObject({
  goal: z.strictObject(claim),
  benefits: z.array(z.strictObject({ ...claim, topic: text, catalogRef: catalogReference })).min(5),
  offices: z.array(z.strictObject({ ...claim, role: text, catalogRef: catalogReference })).min(3),
  forms: z.array(z.strictObject({ ...claim, catalogRef: catalogReference })).min(1),
  documents: z.strictObject({
    ...claim,
    items: z
      .array(
        z.strictObject({
          ...claim,
          requirement: z.enum(["required", "if_available"]),
          obtainFrom: text,
          status: z.enum(["available", "missing", "unknown"]),
        }),
      )
      .min(1),
  }),
  questions: z.strictObject({
    ...claim,
    baseline: z.literal("authored_pending_engine"),
    minimum: z.number().int().nonnegative(),
    slots: z.array(
      z.strictObject({
        name: text,
        reason: z.enum(["missing", "contradictory"]),
        answerable: z.boolean(),
      }),
    ),
  }),
  nextAction: z.strictObject(claim),
  tone: z.strictObject({ ...claim, language: z.enum(["de-AT", "en"]), level: text }),
  followUp: z.strictObject({
    ...claim,
    mode: z.enum(["documented_only", "no_documented_order"]),
    quotes: z.array(documentedQuote),
  }),
  citations: z.strictObject(claim),
  boundary: z.strictObject(claim),
});

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, root), "utf8"));
}

const cases = z.array(CaseSchema).parse(await readJson("cases.json"));
const suite = SuiteSchema.parse(await readJson("suite.json"));
const sources = z
  .array(z.strictObject({ ...SourceSchema.shape, id: text, retrievedAt: z.iso.date() }))
  .parse(await readJson("sources.json"));

function checkReferences(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) checkReferences(item);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "sources") {
        for (const reference of references.parse(child)) {
          expect(sources.map((source) => source.id)).toContain(reference);
        }
      } else checkReferences(child);
    }
  }
}

test("AC1 loads 20 unique synthetic helper personas through the eval harness contracts", () => {
  expect(suite).toMatchObject({
    id: "E4",
    minimumSetSize: 300,
    gate: { kind: "informational", metric: "passRate", threshold: 0.9, direction: "at_least" },
  });
  expect(cases).toHaveLength(20);
  expect(new Set(cases.map((item) => item.id)).size).toBe(20);
  const openings: string[] = [];
  for (const item of cases) {
    expect(item.kind).toBe("synthetic");
    expect(item.tags).toEqual(expect.arrayContaining(["helper", "nightly", "weekly"]));
    const input = InputSchema.parse(item.input);
    const expected = ExpectedSchema.parse(item.expected);
    expect(item.input).toEqual(input);
    expect(item.expected).toEqual(expected);
    expect(input.persona.facts.actor).toMatchObject({ role: "helper", relationship: "child" });
    expect(input.persona.facts.subject).toHaveProperty("relationship", "mother");
    expect(input.persona.goal).toContain("mother");
    expect(expected.tone.language).toBe(input.persona.language);
    openings.push(input.opening.normalize("NFKC").toLowerCase());
  }
  expect(new Set(openings).size).toBe(20);
});

test("AC1 covers both launch languages, every register, missing and conflicting facts, and captions", () => {
  const inputs = cases.map((item) => InputSchema.parse(item.input));
  expect(new Set(inputs.map((input) => input.persona.language))).toEqual(new Set(["de-AT", "en"]));
  for (const register of InputSchema.shape.dimensions.shape.register.options) {
    expect(inputs.filter((input) => input.dimensions.register === register).length).toBeGreaterThan(
      1,
    );
  }
  for (const information of InputSchema.shape.dimensions.shape.information.options) {
    expect(
      inputs.filter((input) => input.dimensions.information === information).length,
    ).toBeGreaterThan(1);
  }
  for (const language of ["de-AT", "en"]) {
    const group = inputs.filter((input) => input.persona.language === language);
    expect(group.some((input) => input.dimensions.register === "simple")).toBe(true);
    expect(group.some((input) => input.dimensions.channel === "voice_captions")).toBe(true);
  }
  expect(new Set(inputs.map((input) => input.persona.carrier)).size).toBeGreaterThanOrEqual(4);
  expect(inputs.some((input) => input.documents.length > 0)).toBe(true);
  expect(inputs.some((input) => input.documents.length === 0)).toBe(true);
  expect(cases.filter((item) => item.tags.includes("pr")).length).toBeGreaterThan(0);
});

test("AC1 every expectation cites evidence and every catalog reference resolves to its recorded ID", async () => {
  expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length);
  for (const source of sources.filter((entry) => entry.uri.startsWith("file:///repo/"))) {
    const path = source.uri.replace("file:///repo/", "").split("#")[0];
    const content = await readFile(new URL(path ?? "", repository), "utf8");
    expect(content, source.id).toContain(source.passage);
  }
  for (const item of cases) {
    const expected = ExpectedSchema.parse(item.expected);
    checkReferences(expected);
    checkReferences(InputSchema.parse(item.input).documents);
    for (const entry of [...expected.benefits, ...expected.offices, ...expected.forms]) {
      const reference = entry.catalogRef;
      if (!reference) continue;
      expect(reference.path).toMatch(
        /^packages\/knowledge\/(catalog|offices|forms)\/.+\.(yaml|json)$/u,
      );
      const content = await readFile(new URL(reference.path, repository), "utf8");
      const id = reference.path.endsWith(".json")
        ? z.object({ id: text }).parse(JSON.parse(content)).id
        : content.match(/^id:\s*"([^"]+)"/mu)?.[1];
      expect(id).toBe(reference.id);
    }
  }
});

test("AC1 question baselines count only missing or conflicting slots and never claim engine measurements", () => {
  for (const item of cases) {
    const input = InputSchema.parse(item.input);
    const { questions } = ExpectedSchema.parse(item.expected);
    expect(questions.minimum).toBe(questions.slots.length);
    expect(new Set(questions.slots.map((slot) => slot.name)).size).toBe(questions.minimum);
    for (const slot of questions.slots) {
      if (slot.reason === "missing") expect(input.initiallyKnownSlots).not.toContain(slot.name);
      else expect(input.dimensions.information).toBe("contradictory");
    }
    if (input.dimensions.information === "missing") {
      expect(questions.slots.some((slot) => !slot.answerable)).toBe(true);
    }
    if (input.dimensions.information === "contradictory") {
      expect(questions.slots.some((slot) => slot.reason === "contradictory")).toBe(true);
    }
  }
});

test("AC2 the versioned rubric validates all nine anchored criteria against the eval harness", async () => {
  const rubric = await loadRubric(new URL("rubric.v1.yaml", root));
  expect(RubricSchema.parse(rubric)).toEqual(rubric);
  expect(rubric.version).toBe("1");
  const standard = await loadRubric(new URL("../../../rubrics/scenario.v1.yaml", root));
  expect(rubric.criteria.map((criterion) => criterion.id).sort()).toEqual(
    standard.criteria.map((criterion) => criterion.id).sort(),
  );
  for (const criterion of rubric.criteria) {
    const scores = criterion.scale === "binary" ? ["0", "1"] : ["0", "1", "2"];
    expect(Object.keys(criterion.anchors)).toEqual(scores);
  }
});

test("AC3 follow-up uses only supplied verbatim document quotes and keeps undocumented care administrative", () => {
  // Manual medical-boundary review is recorded in README.md; schema checks alone cannot prove it.
  for (const item of cases) {
    const input = InputSchema.parse(item.input);
    const expected = ExpectedSchema.parse(item.expected);
    expect(expected.followUp.quotes).toEqual(input.documents);
    expect(expected.followUp.mode).toBe(
      input.documents.length > 0 ? "documented_only" : "no_documented_order",
    );
    expect(expected.benefits.map((benefit) => benefit.topic)).toEqual([
      "care_allowance",
      "care_counseling",
      "mobile_services",
      "care_leave",
      "round_the_clock_support",
    ]);
    expect(expected.boundary.description).toContain("administrative");
    expect(expected.nextAction.description).toContain("user");
    for (const document of input.documents) {
      expect(document.sources.length).toBeGreaterThan(0);
      expect(document.text.length).toBeGreaterThan(0);
    }
  }
});

test("AC3 synthetic document excerpts retain the source annotation text and page exactly", async () => {
  const evidence = sources.find((source) => source.id === "document_evidence");
  expect(evidence).toBeDefined();
  if (!evidence) throw new Error("Missing document provenance");
  const path = evidence.uri.replace("file:///repo/", "");
  const content: unknown = JSON.parse(await readFile(new URL(path, repository), "utf8"));
  const archive = z
    .object({
      cases: z.array(
        z.object({
          expected: z.object({
            annotations: z.array(z.object({ quote: text, page: z.number().int().positive() })),
          }),
        }),
      ),
    })
    .parse(content);
  const annotations = archive.cases.flatMap((item) => item.expected.annotations);
  for (const item of cases) {
    for (const document of InputSchema.parse(item.input).documents) {
      expect(
        annotations.some(
          (annotation) => annotation.quote === document.text && annotation.page === document.page,
        ),
      ).toBe(true);
    }
  }
});
