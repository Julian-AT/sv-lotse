import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type SuiteResult, SummarySchema } from "./schema/index.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function exportResults(results: readonly SuiteResult[], out: string): Promise<void> {
  const summary = SummarySchema.parse({
    schemaVersion: 1,
    suites: results,
    blockingFailures: results
      .filter((result) => result.suite.gate.kind === "blocking" && result.gateVerdict !== "passed")
      .map((result) => result.suite.id),
  });
  if (new Set(results.map((result) => result.suite.id)).size !== results.length)
    throw new Error("Duplicate suite results");
  if (results.some((result) => resolve(out) === resolve(dirname(out), `${result.suite.id}.json`)))
    throw new Error("Summary path collides with a suite result");
  await mkdir(dirname(out), { recursive: true });
  for (const result of summary.suites)
    await writeJson(join(dirname(out), `${result.suite.id}.json`), result);
  await writeJson(out, summary);
}
