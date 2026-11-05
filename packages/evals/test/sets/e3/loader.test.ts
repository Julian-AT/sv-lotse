import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { assertNoLeakage, checkLeakage } from "../../../src/checks/leakage.ts";
import { CaseSchema, SuiteSchema } from "../../../src/schema/index.ts";

const directory = new URL("../../../sets/e3/", import.meta.url);
async function loadSet() {
  const raw: unknown = JSON.parse(await readFile(new URL("questions.json", directory), "utf8"));
  if (!Array.isArray(raw)) throw new Error("E3 must be an array of cases");
  return raw.map((item: unknown) => CaseSchema.parse(item));
}

// Read actual catalog files, including records added by later data work packages.
// Raw text conservatively includes descriptions, criteria and source quotes.
async function catalogCorpus(directoryPath: string): Promise<{ id: string; text: string }[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const records = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directoryPath}/${entry.name}`;
      if (entry.isDirectory()) return catalogCorpus(path);
      if (!/\.(?:ya?ml|json)$/u.test(entry.name)) return [];
      return [{ id: path, text: await readFile(path, "utf8") }];
    }),
  );
  return records.flat();
}

test("E3 AC1 validates 200 unique gold questions stratified across areas A–F", async () => {
  const suite = SuiteSchema.parse(
    JSON.parse(await readFile(new URL("suite.json", directory), "utf8")),
  );
  expect(suite).toMatchObject({
    id: "E3",
    minimumSetSize: 200,
    gate: { kind: "informational", metric: "recall@10", threshold: 0.9 },
  });
  const cases = await loadSet();
  expect(cases).toHaveLength(200);
  expect(new Set(cases.map((item) => item.id)).size).toBe(200);
  const questions = new Set<string>();
  for (const item of cases) {
    expect(item.kind).toBe("gold");
    expect(item.input).toEqual({
      area: expect.stringMatching(/^[A-F]$/u),
      question: expect.stringMatching(/\S.+\?$/u),
    });
    if (typeof item.input !== "object" || item.input === null || Array.isArray(item.input)) {
      throw new Error("Invalid E3 input");
    }
    questions.add(String(item.input.question).normalize("NFKC").toLowerCase());
    expect(item.tags).toContain(`area:${item.input.area}`);
    for (const prefix of ["carrier:", "region:", "life:", "language:"]) {
      expect(item.tags.some((tag) => tag.startsWith(prefix) && tag.length > prefix.length)).toBe(
        true,
      );
    }
    expect(item.tags).toContain("synthetic-question");
  }
  expect(questions.size).toBe(200);
  for (const language of ["de-AT", "de-simple", "en"]) {
    expect(cases.some((item) => item.tags.includes(`language:${language}`))).toBe(true);
  }
  for (const term of ["Spital", "e-card", "Rezeptgebühr", "Chefarzt"]) {
    expect([...questions].some((question) => question.includes(term.toLowerCase()))).toBe(true);
  }
  for (const area of ["A", "B", "C", "D", "E", "F"]) {
    expect(
      cases.filter((item) => item.tags.includes(`area:${area}`)).length,
    ).toBeGreaterThanOrEqual(area === "E" || area === "F" ? 15 : 25);
  }
});

test("E3 AC2 validates official source URLs and verified verbatim passages for every case", async () => {
  const cases = await loadSet();
  const provenance: unknown = JSON.parse(
    await readFile(new URL("sources.json", directory), "utf8"),
  );
  if (!Array.isArray(provenance)) throw new Error("E3 source manifest must be an array");
  const sources = provenance.map((raw: unknown) => {
    if (typeof raw !== "object" || raw === null || !("uri" in raw) || !("passages" in raw)) {
      throw new Error("Invalid E3 source manifest entry");
    }
    expect(raw).toMatchObject({
      retrievedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      passages: expect.arrayContaining([expect.stringMatching(/\S/u)]),
    });
    return raw;
  });
  for (const item of cases) {
    if (item.kind !== "gold") throw new Error("E3 requires gold cases");
    const url = new URL(item.source.uri);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toMatch(
      /(?:^|\.)(?:gesundheit\.gv\.at|sozialversicherung\.gv\.at|sozialministerium\.gv\.at|sozialministeriumservice\.gv\.at|oesterreich\.gv\.at|svs\.at|bvaeb\.at|gesundheitskasse\.at|oegk\.at|bmf\.gv\.at|fsw\.at|bewegt-im-park\.at|pv\.at)$/u,
    );
    expect(item.source.passage.trim().length).toBeGreaterThan(25);
    expect(sources).toContainEqual(
      expect.objectContaining({
        uri: item.source.uri,
        passages: expect.arrayContaining([item.source.passage]),
      }),
    );
    // Retrieval targets are source passages, not generated medical answers.
    expect(item.expected).toEqual({
      relevantPassages: [
        {
          uri: item.source.uri,
          passageSha256: createHash("sha256").update(item.source.passage, "utf8").digest("hex"),
        },
      ],
    });
  }
  expect(new Set(sources.map((source) => source.uri))).toEqual(
    new Set(cases.flatMap((item) => (item.kind === "gold" ? [item.source.uri] : []))),
  );
});

test("E3 AC3 passes harness leakage detection against all existing catalog records", async () => {
  const cases = await loadSet();
  const corpus = await catalogCorpus(
    fileURLToPath(new URL("../../../../knowledge/catalog/", import.meta.url)),
  );
  expect(checkLeakage(cases, corpus)).toEqual([]);
  expect(() => assertNoLeakage(cases, corpus)).not.toThrow();
});
