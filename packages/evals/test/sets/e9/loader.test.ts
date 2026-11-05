import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import { CaseSchema } from "../../../src/schema/index.ts";

const directory = new URL("../../../sets/e9/", import.meta.url);
const phrases = z.array(z.string().min(1));
const InputSchema = z.object({ utterance: z.string().min(1), language: z.literal("de-AT") });
const ExpectedSchema = z.object({
  transcript: z.string().min(1),
  annotations: z.object({
    domainTerms: phrases,
    numbers: phrases,
    dates: phrases,
    names: phrases,
    dialect: phrases,
  }),
});
const VocabularySchema = z.array(z.object({ term: z.string().min(1), forms: phrases }));

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, directory), "utf8"));
}

async function loadCases() {
  const cases = z.array(CaseSchema).parse(await readJson("cases.json"));
  return cases.map((item) => {
    const input = InputSchema.parse(item.input);
    const expected = ExpectedSchema.parse(item.expected);
    expect(item.input, item.id).toEqual(input);
    expect(item.expected, item.id).toEqual(expected);
    return { ...item, input, expected };
  });
}

test("E9 AC1 loads exactly 200 unique utterances with verbatim reference transcripts", async () => {
  const cases = await loadCases();

  expect(cases).toHaveLength(200);
  expect(new Set(cases.map((item) => item.id)).size).toBe(200);
  expect(
    new Set(cases.map((item) => item.input.utterance.normalize("NFKC").toLowerCase())).size,
  ).toBe(200);
  for (const item of cases) {
    expect(item.id).toMatch(/^e9-\d{3}$/u);
    expect(item.kind, item.id).toBe("synthetic");
    expect(item.expected.transcript, item.id).toBe(item.input.utterance);
    expect(item.expected.transcript.trim(), item.id).toBe(item.expected.transcript);
    // Spoken numbers remain words; display-oriented digit normalization is a later concern.
    expect(item.expected.transcript, item.id).not.toMatch(/\d/u);
  }
});

test("E9 AC1 has at least 120 genuinely domain-bearing utterances covering all required terms", async () => {
  const cases = await loadCases();
  const vocabulary = VocabularySchema.parse(await readJson("terms.json"));

  expect(vocabulary).toHaveLength(9);
  expect(new Set(vocabulary.map((entry) => entry.term)).size).toBe(9);
  const covered = new Set<string>();
  for (const entry of vocabulary) expect(entry.forms).toContain(entry.term);
  for (const item of cases) {
    const present = vocabulary.flatMap((entry) => {
      const matches = entry.forms.filter((form) => item.expected.transcript.includes(form));
      if (matches.length > 0) covered.add(entry.term);
      return matches;
    });
    expect(item.expected.annotations.domainTerms.toSorted(), item.id).toEqual(present.toSorted());
  }
  expect(covered.size).toBe(vocabulary.length);
  expect(cases.filter((item) => item.tags.includes("domain-term")).length).toBeGreaterThanOrEqual(
    120,
  );
});

test("E9 tags describe actual annotated terms, numbers, dates, names and dialect", async () => {
  const cases = await loadCases();
  const categories = [
    ["domainTerms", "domain-term"],
    ["numbers", "number"],
    ["dates", "date"],
    ["names", "name"],
    ["dialect", "dialect"],
  ] as const;

  for (const item of cases) {
    const expectedTags = ["synthetic", "nightly", "weekly"];
    for (const [annotation, tag] of categories) {
      const spans = item.expected.annotations[annotation];
      expect(new Set(spans).size, item.id).toBe(spans.length);
      for (const span of spans) {
        expect(span.trim(), item.id).toBe(span);
        expect(item.expected.transcript, item.id).toContain(span);
      }
      if (spans.length > 0) expectedTags.push(tag);
    }
    expect(item.tags.toSorted(), item.id).toEqual(expectedTags.toSorted());
  }
  for (const [, tag] of categories) {
    expect(cases.filter((item) => item.tags.includes(tag)).length, tag).toBeGreaterThanOrEqual(20);
  }
  expect(cases.some((item) => !item.tags.includes("domain-term"))).toBe(true);
});
