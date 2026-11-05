import { afterEach, expect, test } from "vitest";
import { loadKnowledge } from "../../src/loader/index.ts";
import { benefit, fixtureRoot, removeFixture, source } from "./fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeFixture));
});
async function load(overrides: Record<string, unknown> = {}) {
  const root = await fixtureRoot(overrides);
  roots.push(root);
  return loadKnowledge(root);
}
test("AC1 loads every schema, resolves cyclic record links and fragments, and deeply freezes knowledge", async () => {
  const knowledge = await load();
  expect(Object.keys(knowledge.catalog)).toEqual([benefit.id]);
  expect(knowledge.resolve("ref:catalog/fixture-benefit#criteria")).toEqual(benefit.criteria);
  expect(knowledge.resolve("ref:processes/fixture-process")).toBe(
    knowledge.processes["fixture-process"],
  );
  expect(Object.isFrozen(knowledge)).toBe(true);
  expect(Object.isFrozen(knowledge.catalog)).toBe(true);
  expect(Object.isFrozen(knowledge.catalog[benefit.id]?.criteria[0]?.source)).toBe(true);
  expect(knowledge.allowlist?.origins).toHaveLength(1);
});
test.each([
  [{ ...benefit, sources: [{ ...source, quote: undefined }] }, "sources.0.quote"],
  [{ ...benefit, as_of: undefined }, "as_of"],
  [{ ...benefit, area: "G" }, "area"],
  [{ ...benefit, process: "ref:processes/missing" }, "process"],
  [{ ...benefit, process: "ref:offices/fixture-office" }, "process"],
  [{ ...benefit, unexpected: true }, "unexpected"],
])("AC1 reports file and path for invalid records", async (record, path) => {
  await expect(load({ "catalog/benefit.yaml": record })).rejects.toThrow(
    new RegExp(`catalog/benefit.yaml.*${path.replaceAll(".", "\\.")}`),
  );
});
test("AC1 reports both files and id path for duplicate ids", async () => {
  await expect(load({ "catalog/copy.yaml": benefit })).rejects.toThrow(
    /catalog\/copy.yaml.*id.*catalog\/benefit.yaml/,
  );
});
test("AC1 rejects a dangling fragment", async () => {
  await expect(
    load({ "catalog/benefit.yaml": { ...benefit, forms: ["ref:forms/fixture-form#missing"] } }),
  ).rejects.toThrow(/catalog\/benefit.yaml.*forms.0/);
});

test("AC1 rejects a nonexistent package root instead of treating it as an empty catalog", async () => {
  const root = await fixtureRoot();
  roots.push(root);
  await expect(loadKnowledge(`${root}/missing`)).rejects.toThrow(/missing.*\$.*root/);
});

test("AC1 reports the file and root path for duplicate YAML mapping keys", async () => {
  const { writeFile } = await import("node:fs/promises");
  const root = await fixtureRoot();
  roots.push(root);
  await writeFile(`${root}/catalog/benefit.yaml`, "id: first\nid: second\n");
  await expect(loadKnowledge(root)).rejects.toThrow(/catalog\/benefit.yaml.*\$.*YAML/);
});
