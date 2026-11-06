import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertNoLeakage } from "../checks/leakage.ts";
import { CaseSchema, type EvalCase, type Suite, SuiteSchema } from "../schema/index.ts";

export const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const SETS = resolve(ROOT, "packages/evals/sets");

export async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
export async function dataset(suite: string): Promise<{ suite: Suite; cases: EvalCase[] }> {
  const directory = resolve(SETS, suite.toLowerCase());
  const value = await jsonFile(resolve(directory, "gold.json"));
  return z.object({ suite: SuiteSchema, cases: z.array(CaseSchema) }).parse(value);
}
export async function splitDataset(
  suite: string,
  casesFile: string,
): Promise<{ suite: Suite; cases: EvalCase[] }> {
  const directory = resolve(SETS, suite.toLowerCase());
  return {
    suite: SuiteSchema.parse(await jsonFile(resolve(directory, "suite.json"))),
    cases: z.array(CaseSchema).parse(await jsonFile(resolve(directory, casesFile))),
  };
}
export function containedPath(directory: string, relative: string): string {
  const path = resolve(directory, relative);
  if (!path.startsWith(resolve(directory) + sep)) throw new Error("invalid_fixture_path");
  return path;
}
export async function verifiedBytes(
  directory: string,
  path: string,
  hash: string,
): Promise<Uint8Array> {
  const bytes = await readFile(containedPath(directory, path));
  if (createHash("sha256").update(bytes).digest("hex") !== hash)
    throw new Error("fixture_hash_mismatch");
  return Uint8Array.from(bytes);
}
async function corpus(directory: string): Promise<{ id: string; text: string }[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const records = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return corpus(path);
      return /\.(yaml|yml|json)$/u.test(entry.name)
        ? [{ id: path, text: await readFile(path, "utf8") }]
        : [];
    }),
  );
  return records.flat();
}
export async function checkGold(cases: readonly unknown[]): Promise<void> {
  assertNoLeakage(cases, await corpus(resolve(ROOT, "packages/knowledge/catalog")));
}
export function normalized(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
