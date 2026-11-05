import { readdir, readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { z } from "zod";
import { assertNoLeakage } from "../../../src/checks/leakage.ts";
import { CaseSchema, SuiteSchema } from "../../../src/schema/index.ts";

const root = new URL("../../../sets/e11/", import.meta.url);
const readJson = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(name, root), "utf8"));
const InputSchema = z.object({
  utterance: z.string().min(1),
  language: z.enum(["de-AT", "en", "tr", "bs", "uk"]),
  register: z.enum(["colloquial", "simple", "standard"]),
});
const ExpectedSchema = z.object({ slots: z.record(z.string(), z.string()) });
const domains = {
  insurance_status: ["insured", "uninsured", "co_insured", "self_insured"],
  carrier: ["OEGK", "SVS", "BVAEB"],
  federal_state: [
    "Burgenland",
    "Kaernten",
    "Niederoesterreich",
    "Oberoesterreich",
    "Salzburg",
    "Steiermark",
    "Tirol",
    "Vorarlberg",
    "Wien",
  ],
  age_band: ["under_18", "18_to_39", "40_to_44", "45_to_74", "75_plus"],
  care_need: ["help_reported", "no_help_reported"],
  helper_relation: [
    "self",
    "child",
    "parent",
    "partner",
    "sibling",
    "grandchild",
    "friend",
    "neighbor",
  ],
  income_band: ["no_income", "under_1000", "1000_to_under_2000", "2000_plus"],
};
const slotNames = [...Object.keys(domains), "hospital_discharge_date", "child_birth_date"];
const definitions = z
  .array(
    z.object({
      name: z.string().min(1),
      passage: z.string().min(1),
      basis: z.object({ uri: z.url(), passage: z.string().min(1) }),
    }),
  )
  .parse(await readJson("slot-definitions.json"));
const cases = z.array(CaseSchema).parse(await readJson("cases.json"));
const suite = SuiteSchema.parse(await readJson("suite.json"));

test("E11 AC1 contains 300 unique utterances including at least 60 non-German or simple-language items", () => {
  expect(suite).toMatchObject({
    id: "E11",
    minimumSetSize: 300,
    gate: { kind: "informational", metric: "slotAccuracy", threshold: 0.95, direction: "at_least" },
  });
  expect(cases).toHaveLength(300);
  expect(new Set(cases.map((item) => item.id)).size).toBe(300);
  const inputs = cases.map((item) => InputSchema.parse(item.input));
  expect(new Set(inputs.map((input) => input.utterance.normalize("NFKC").toLowerCase())).size).toBe(
    300,
  );
  expect(
    inputs.filter((input) => input.language !== "de-AT" || input.register === "simple").length,
  ).toBeGreaterThanOrEqual(60);
  for (const language of InputSchema.shape.language.options) {
    expect(inputs.filter((input) => input.language === language).length).toBeGreaterThan(0);
  }
});

test("E11 AC2 validates every gold item, normalized slot value and definition source", async () => {
  const readme = await readFile(new URL("README.md", root), "utf8");
  expect(definitions.map((definition) => definition.name).sort()).toEqual([...slotNames].sort());
  const seen = new Set<string>();
  for (const item of cases) {
    expect(item.kind).toBe("gold");
    expect(item.tags).toContain("synthetic");
    InputSchema.parse(item.input);
    const expected = ExpectedSchema.parse(item.expected);
    expect(item.expected).toEqual(expected);
    const { slots } = expected;
    expect(Object.keys(slots).length).toBeGreaterThan(0);
    const passages: string[] = [];
    for (const [name, value] of Object.entries(slots)) {
      expect(slotNames).toContain(name);
      seen.add(name);
      const domain = Object.entries(domains).find(([key]) => key === name)?.[1];
      if (domain) expect(domain).toContain(value);
      else {
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(new Date(value).toISOString().slice(0, 10)).toBe(value);
      }
      const definition = definitions.find((entry) => entry.name === name);
      expect(definition).toBeDefined();
      if (!definition) throw new Error(`Missing definition: ${name}`);
      expect(readme).toContain(definition.passage);
      const basisPath = definition.basis.uri.replace("file:///repo/", "../../../../");
      const basis = await readFile(new URL(basisPath, root), "utf8");
      expect(basis).toContain(definition.basis.passage);
      passages.push(definition.passage);
    }
    expect(item.source).toEqual({
      uri: "file:///repo/packages/evals/sets/e11/README.md#slot-definitions",
      passage: passages.join("\n"),
    });
  }
  expect([...seen].sort()).toEqual([...slotNames].sort());
});

test("E11 AC3 gold outputs contain administrative values only, with no medical advice", () => {
  // Closed slot names and values above prevent free-text advice in the expected output.
  // The authored utterances also receive a manual medical-boundary review; this is a regression guard.
  const prohibited =
    /diagnos|therap|medikament|dosier|dosage|medication|treatment|risk|risiko|tablett|antibiot/iu;
  for (const item of cases) {
    expect(InputSchema.parse(item.input).utterance).not.toMatch(prohibited);
    expect(item.expected).toEqual(ExpectedSchema.parse(item.expected));
  }
});

test("E11 AC2 extracts insurance status wherever the subject explicitly has coverage", () => {
  // Editorially reviewed coverage statements, including personal insurer affiliation.
  // Merely naming the institution on a letter does not establish current coverage.
  const insured = [
    31, 32, 35, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 50, 51, 53, 54, 55, 56, 58, 59,
    60, 271, 272, 274, 278, 280, 283, 286, 290, 292, 293, 296, 297, 299,
  ];
  for (const number of insured) {
    const id = `e11-${String(number).padStart(3, "0")}`;
    const item = cases.find((entry) => entry.id === id);
    expect(item, id).toBeDefined();
    expect(ExpectedSchema.parse(item?.expected).slots.insurance_status, id).toBe("insured");
  }
  for (const id of ["e11-033", "e11-034", "e11-043", "e11-052", "e11-057"]) {
    const item = cases.find((entry) => entry.id === id);
    expect(item, id).toBeDefined();
    expect(ExpectedSchema.parse(item?.expected).slots).not.toHaveProperty("insurance_status");
  }
  for (const item of cases) {
    const names = Object.keys(ExpectedSchema.parse(item.expected).slots);
    for (const name of names) expect(item.tags, item.id).toContain(name);
    if (item.tags.includes("single-slot")) expect(names, item.id).toHaveLength(1);
  }
});

test("E11 AC2 anchors the fortieth birthday case to the subject's current age", () => {
  const item = cases.find((entry) => entry.id === "e11-094");
  expect(InputSchema.parse(item?.input).utterance).toBe("Ich bin gerade vierzig geworden.");
  expect(ExpectedSchema.parse(item?.expected).slots).toEqual({ age_band: "40_to_44" });
});

test("E11 AC2 explicitly relates the child birth date to the subject's son", () => {
  const item = cases.find((entry) => entry.id === "e11-243");
  expect(InputSchema.parse(item?.input).utterance).toBe(
    "Mein Sohn ist am ersten Februar 2026 geboren.",
  );
  expect(ExpectedSchema.parse(item?.expected).slots).toEqual({ child_birth_date: "2026-02-01" });
});

test("E11 gold slots pass the harness leakage check against every existing catalog record", async () => {
  const directory = new URL("../../../knowledge/catalog/", root);
  async function records(path: URL): Promise<{ id: string; text: string }[]> {
    const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    const result: { id: string; text: string }[] = [];
    for (const entry of entries) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), path);
      if (entry.isDirectory()) result.push(...(await records(url)));
      else if (/\.(yaml|yml|json)$/u.test(entry.name)) {
        result.push({ id: url.pathname, text: await readFile(url, "utf8") });
      }
    }
    return result;
  }
  assertNoLeakage(cases, await records(directory));
});
