import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  CaseSchema,
  JudgeRunSchema,
  loadRubric,
  PersonaSpecSchema,
  SourceSchema,
  SuiteSchema,
  scoreSchema,
} from "../../../../src/index.ts";

const root = new URL("../../../../sets/e4/s2/", import.meta.url);
const repository = new URL("../../../../../../", import.meta.url);
const text = z.string().trim().min(1);
const references = z.array(text).min(1);
const dimensions = [
  "german",
  "english",
  "simple_language",
  "dialect",
  "colloquial",
  "helper",
  "missing_information",
  "contradictory_information",
  "voice_captions_only",
] as const;
const InputSchema = z.strictObject({
  openingUtterance: text,
  dimensions: z.array(z.enum(dimensions)).min(1),
  persona: PersonaSpecSchema,
});
const FactsSchema = z.object({
  openingUtterance: text,
  subject: z.object({
    age: z.number().int(),
    carrier: text,
    region: text,
    sexForProgram: z.enum(["woman", "man", "not_stated"]),
  }),
  actor: z.enum(["self", "helper"]),
  register: z.enum(["standard", "simple", "dialect", "colloquial"]),
  channel: z.enum(["workspace", "voice_captions_only"]),
  initiallyDisclosed: z.array(text),
  followUpAnswers: z.record(text, text),
  conflictingStatements: z
    .array(
      z.strictObject({
        slot: text,
        values: z.array(z.json()).min(2),
      }),
    )
    .optional(),
  selectedStep: z.enum(["checkup", "park", "nutrition", "breast", "colon", "doctor", "voucher"]),
});
const ExpectedSchema = z.strictObject({
  goal: references,
  benefits: references,
  offices: references,
  documents: references,
  forms: references,
  nextActions: references,
  boundary: references,
  citations: references,
  questions: z.strictObject({
    minimum: z.number().int().nonnegative(),
    requiredSlots: z.array(text),
    rationale: text,
    sources: references,
  }),
  presentation: z.strictObject({
    language: z.enum(["de-AT", "en"]),
    register: FactsSchema.shape.register,
    channel: FactsSchema.shape.channel,
    sources: references,
  }),
});
const SourceRecordSchema = SourceSchema.extend({
  id: text,
  verifiedAt: z.iso.date(),
  section: text,
});
const OutcomeSchema = z.strictObject({
  id: text,
  category: z.enum([
    "goal",
    "benefits",
    "offices",
    "documents",
    "forms",
    "nextActions",
    "boundary",
    "citations",
  ]),
  description: text,
  sources: references,
  catalog: z
    .strictObject({
      kind: z.enum(["benefit", "office", "form"]),
      id: text,
      path: text,
    })
    .optional(),
});

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, root), "utf8"));
}

async function loadData() {
  return {
    cases: z.array(CaseSchema).parse(await readJson("cases.json")),
    outcomes: z.array(OutcomeSchema).parse(await readJson("outcomes.json")),
    sources: z.array(SourceRecordSchema).parse(await readJson("sources.json")),
  };
}

test("AC1 loads 20 unique harness cases and preserves the E4 release minimum", async () => {
  const { cases } = await loadData();
  const suite = SuiteSchema.parse(await readJson("suite.json"));
  expect(suite).toMatchObject({
    id: "E4",
    minimumSetSize: 300,
    gate: { kind: "informational", metric: "passRate", threshold: 0.9, direction: "at_least" },
  });
  expect(cases).toHaveLength(20);
  expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  const inputs = cases.map((item) => InputSchema.parse(item.input));
  expect(new Set(inputs.map((input) => input.openingUtterance)).size).toBe(cases.length);
  for (const dimension of dimensions) {
    expect(inputs.filter((input) => input.dimensions.includes(dimension)).length).toBeGreaterThan(
      0,
    );
  }
  for (const item of cases) {
    expect(item.kind).toBe("gold");
    expect(item.tags).toEqual(expect.arrayContaining(["synthetic-persona", "nightly", "weekly"]));
  }
  expect(cases.filter((item) => item.tags.includes("pr")).length).toBeGreaterThan(0);
});

test("AC1 dimensions correspond to persona facts, language, actor and interaction mode", async () => {
  const { cases } = await loadData();
  for (const item of cases) {
    const input = InputSchema.parse(item.input);
    const facts = FactsSchema.parse(input.persona.facts);
    const expected = ExpectedSchema.parse(item.expected);
    expect(facts.openingUtterance).toBe(input.openingUtterance);
    expect(input.persona.style).toContain("openingUtterance");
    expect(input.persona.goal.length).toBeGreaterThan(20);
    expect(expected.presentation).toMatchObject({
      language: input.persona.language,
      register: facts.register,
      channel: facts.channel,
    });
    expect(input.dimensions.includes("german")).toBe(input.persona.language === "de-AT");
    expect(input.dimensions.includes("english")).toBe(input.persona.language === "en");
    expect(input.dimensions.includes("helper")).toBe(facts.actor === "helper");
    expect(input.dimensions.includes("voice_captions_only")).toBe(
      facts.channel === "voice_captions_only",
    );
    for (const register of ["simple", "dialect", "colloquial"] as const) {
      const dimension = register === "simple" ? "simple_language" : register;
      expect(input.dimensions.includes(dimension)).toBe(facts.register === register);
    }
    if (facts.actor === "self") {
      expect(input.persona.age).toBe(facts.subject.age);
      expect(input.persona.carrier).toBe(facts.subject.carrier);
      expect(input.persona.region).toBe(facts.subject.region);
    } else {
      expect(input.persona.age).not.toBe(facts.subject.age);
      expect(input.persona.style).toContain("subject");
    }
  }
});

test("AC1 missing and conflicting facts have answerable minimal slot questions", async () => {
  const { cases } = await loadData();
  for (const item of cases) {
    const input = InputSchema.parse(item.input);
    const facts = FactsSchema.parse(input.persona.facts);
    const { questions } = ExpectedSchema.parse(item.expected);
    expect(new Set(questions.requiredSlots).size).toBe(questions.requiredSlots.length);
    expect(questions.minimum).toBe(questions.requiredSlots.length);
    for (const slot of questions.requiredSlots) {
      expect(facts.followUpAnswers[slot]).toBeTruthy();
      expect(facts.initiallyDisclosed).not.toContain(slot);
    }
    if (input.dimensions.includes("contradictory_information")) {
      expect(questions.minimum).toBeGreaterThan(0);
      expect(facts.conflictingStatements?.length).toBeGreaterThan(0);
      for (const conflict of facts.conflictingStatements ?? []) {
        expect(questions.requiredSlots).toContain(conflict.slot);
        expect(new Set(conflict.values.map((value) => JSON.stringify(value))).size).toBeGreaterThan(
          1,
        );
      }
    }
  }
  const missing = cases.filter((item) =>
    InputSchema.parse(item.input).dimensions.includes("missing_information"),
  );
  expect(missing.some((item) => ExpectedSchema.parse(item.expected).questions.minimum > 0)).toBe(
    true,
  );
  // Missing insurance must not block an offer whose published access rules do not require it.
  expect(missing.some((item) => ExpectedSchema.parse(item.expected).questions.minimum === 0)).toBe(
    true,
  );
});

test("AC1 all variants cover the prevention bundle and published screening age boundaries", async () => {
  const { cases } = await loadData();
  for (const item of cases) {
    const { persona } = InputSchema.parse(item.input);
    const { subject, selectedStep } = FactsSchema.parse(persona.facts);
    const expected = ExpectedSchema.parse(item.expected);
    expect(expected.benefits).toEqual(
      expect.arrayContaining([
        "adult-checkup",
        "vaccination-status",
        "screening-overview",
        "park-offer",
        "nutrition-regional",
      ]),
    );
    expect(expected.benefits.includes("colon-target")).toBe(subject.age >= 45);
    expect(expected.benefits.includes("breast-standard")).toBe(
      subject.sexForProgram === "woman" && subject.age >= 45 && subject.age <= 74,
    );
    expect(expected.benefits.includes("breast-optin")).toBe(
      subject.sexForProgram === "woman" && subject.age >= 40 && subject.age <= 44,
    );
    if (selectedStep === "breast" && subject.age < 45) {
      expect(expected.nextActions).toEqual(["activate-breast"]);
    }
    if (selectedStep === "voucher") {
      expect(expected.benefits).toContain("uninsured-checkup");
      expect(expected.documents).toEqual(["voucher-documents"]);
    }
    if (selectedStep === "doctor" && subject.age < 40) {
      expect(expected.benefits).toContain("family-history-clinician");
      expect(expected.nextActions).toEqual(["search-doctor"]);
    }
  }
});

test("AC1 every expected outcome resolves to a correctly categorized, sourced description", async () => {
  const { cases, outcomes, sources } = await loadData();
  expect(new Set(outcomes.map((outcome) => outcome.id)).size).toBe(outcomes.length);
  const referenced = new Set<string>();
  for (const item of cases) {
    const expected = ExpectedSchema.parse(item.expected);
    expect(item.expected).toEqual(expected);
    const expanded: Record<string, unknown> = {};
    for (const [category, ids] of Object.entries(expected)) {
      if (!Array.isArray(ids)) continue;
      expanded[category] = ids.map((id) => {
        referenced.add(id);
        const outcome = outcomes.find((entry) => entry.id === id);
        expect(outcome?.category, id).toBe(category);
        if (!outcome) throw new Error("Missing outcome");
        return {
          ...outcome,
          sources: outcome.sources.map((sourceId) => {
            const source = sources.find((entry) => entry.id === sourceId);
            if (!source) throw new Error("Missing source");
            return SourceSchema.parse(source);
          }),
        };
      });
    }
    for (const group of [expected.questions, expected.presentation]) {
      for (const id of group.sources)
        expect(
          sources.some((source) => source.id === id),
          id,
        ).toBe(true);
    }
    if (item.kind !== "gold") throw new Error("Gold cases require a source");
    expect(sources).toContainEqual(expect.objectContaining(item.source));
    JudgeRunSchema.parse({
      transcript: [{ role: "user", text: InputSchema.parse(item.input).openingUtterance }],
      expected: JSON.stringify({ ...expected, ...expanded }),
    });
  }
  expect([...referenced].sort()).toEqual(outcomes.map((outcome) => outcome.id).sort());
});

test("AC1 existing catalog IDs resolve to real records rather than invented identifiers", async () => {
  const { outcomes } = await loadData();
  const references = outcomes.flatMap((outcome) => (outcome.catalog ? [outcome.catalog] : []));
  expect(references.length).toBeGreaterThan(0);
  for (const reference of references) {
    const directory = { benefit: "catalog", office: "offices", form: "forms" }[reference.kind];
    expect(reference.path.startsWith(`packages/knowledge/${directory}/`)).toBe(true);
    const record = await readFile(new URL(reference.path, repository), "utf8");
    expect(record.match(/^id:\s*"?([\w-]+)"?$/mu)?.[1]).toBe(reference.id);
  }
});

test("AC1 source manifest has dated official passages and verifiable local requirement quotes", async () => {
  const { sources } = await loadData();
  expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length);
  const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
  for (const source of sources) {
    const url = new URL(source.uri);
    if (url.protocol === "file:") {
      expect(url.pathname.startsWith("/repo/")).toBe(true);
      const content = await readFile(
        new URL(url.pathname.slice("/repo/".length), repository),
        "utf8",
      );
      expect(normalize(content)).toContain(normalize(source.passage));
    } else {
      expect(url.protocol).toBe("https:");
      expect(source.section.length).toBeGreaterThan(3);
      expect(source.passage.length).toBeGreaterThan(15);
    }
  }
});

test("AC2 The eval harness loads all nine versioned rubric criteria with complete score anchors", async () => {
  const rubric = await loadRubric(new URL("rubric.v1.yaml", root));
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
  const maximum = Object.fromEntries(
    rubric.criteria.map((criterion) => [
      criterion.id,
      {
        score: criterion.scale === "binary" ? 1 : 2,
        rationale: "Supported by the transcript and resolved source-backed expectations.",
      },
    ]),
  );
  const schema = scoreSchema(rubric);
  expect(schema.safeParse(maximum).success).toBe(true);
  expect(
    schema.safeParse({ ...maximum, boundary: { score: 2, rationale: "Invalid binary score." } })
      .success,
  ).toBe(false);
});

test("AC3 every case requires the medical boundary and source-backed administrative navigation", async () => {
  // Manual review is recorded in README.md. This checks the required evaluation controls,
  // not whether arbitrary natural-language medical advice can be detected by a word list.
  const { cases, outcomes } = await loadData();
  for (const item of cases) {
    const expected = ExpectedSchema.parse(item.expected);
    expect(expected.boundary).toHaveLength(1);
    expect(
      outcomes.find((entry) => entry.id === expected.boundary[0])?.sources.length,
    ).toBeGreaterThan(0);
    expect(expected.citations).toHaveLength(1);
  }
  const readme = await readFile(new URL("README.md", root), "utf8");
  expect(readme).toContain("Manual medical-boundary review");
  expect(readme).toContain("not a human-calibrated judge");
});
