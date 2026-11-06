import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { PIPELINE_CONFIG, parseBrainConfig } from "@lotse/brain/config";
import { DOCUMENT_EXTRACTION_VERSION } from "@lotse/brain/documents";
import { createDatabase } from "@lotse/db";
import { BASELINE_CONFIG, E4_CONFIG, readModelConfig } from "../config.ts";
import { loadScenarios } from "../e4/data.ts";
import { createE4Suite } from "../e4/index.ts";
import { createLiveE5Adapter } from "../e5/adapter.ts";
import { createE5Suite } from "../e5/index.ts";
import { E5_JUDGE_VERSION } from "../e5/judge.ts";
import { e7Suite } from "../e7/index.ts";
import { exportResults } from "../export.ts";
import { type RegisteredSuite, runSuite } from "../runner/index.ts";
import { type SuiteResult, SuiteResultSchema, SummarySchema } from "../schema/index.ts";
import { jsonFile, ROOT, SETS } from "./data.ts";
import { e1Suite } from "./e1.ts";
import { e3Suite } from "./e3.ts";
import { e11Suite } from "./e11.ts";
import { e12Suite } from "./e12.ts";
import { e13Suite } from "./e13.ts";

const environment = resolve(ROOT, ".env.local");
if (existsSync(environment)) loadEnvFile(environment);
const { values } = parseArgs({
  options: {
    suite: { type: "string", default: "E1,E3,E5,E7,E11,E12,E13,E4" },
    out: { type: "string", default: BASELINE_CONFIG.defaultOutput },
    sample: { type: "string" },
    "e5-result": { type: "string" },
    "reuse-dir": { type: "string" },
  },
});
const requested = values.suite.split(",");
if (requested.some((suite) => !["E1", "E3", "E4", "E5", "E7", "E11", "E12", "E13"].includes(suite)))
  throw new Error("unsupported_suite");
const sample = values.sample === undefined ? undefined : Number(values.sample);
if (sample !== undefined && (!Number.isSafeInteger(sample) || sample < 1))
  throw new Error("invalid_sample");
if (sample !== undefined && (values["reuse-dir"] || values["e5-result"]))
  throw new Error("cannot_sample_imported_results");
const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const results: SuiteResult[] = [];
const gaps: { suite: string; reason: string }[] = [];
const out = resolve(ROOT, values.out);
async function definitionFor(
  id: string,
): Promise<{ definition: RegisteredSuite; close?: () => Promise<void> }> {
  if (id === "E1") return { definition: await e1Suite() };
  if (id === "E3") return e3Suite();
  if (id === "E7") return e7Suite();
  if (id === "E11") return { definition: await e11Suite() };
  if (id === "E12") return { definition: await e12Suite() };
  if (id === "E13") return { definition: await e13Suite() };
  if (id === "E4") {
    const data = await loadScenarios(["s3"]);
    const database = createDatabase();
    return { definition: createE4Suite(data, database, parseBrainConfig()), close: database.close };
  }
  if (id === "E5")
    return {
      definition: createE5Suite(
        await jsonFile(resolve(SETS, "e5/cases.json")),
        await jsonFile(resolve(SETS, "e5/suite.json")),
        createLiveE5Adapter(),
      ),
    };
  throw new Error("missing_adapter");
}
function modelVersion(id: string): string {
  if (id === "E1") return "deterministic-existing-tests/1";
  if (id === "E13") return "brain-field-detector/auto";
  if (id === "E7") return "brain-form-prefill/2";
  const { models } = parseBrainConfig();
  if (id === "E4") {
    const evaluation = readModelConfig();
    return `${E4_CONFIG.version};orchestrator=${models.orchestrator.primary};persona=${evaluation.EVAL_PERSONA_MODEL};judge=${evaluation.EVAL_JUDGE_MODEL}`;
  }
  if (id === "E3")
    return `hybrid/${models.embedding.primary};rrf=${PIPELINE_CONFIG.rrfConstant};weights=${PIPELINE_CONFIG.retrievalWeights.join(",")};query=original;reranker=none`;
  if (id === "E5")
    return `brain-text/${models.orchestrator.primary};guard/${models.guard.primary};judge/${E5_JUDGE_VERSION}`;
  return `${id === "E11" ? BASELINE_CONFIG.e11PromptVersion : DOCUMENT_EXTRACTION_VERSION}/${models.extractor.primary}`;
}
for (const id of requested) {
  let close: (() => Promise<void>) | undefined;
  console.info(JSON.stringify({ event: "suite_started", suite: id }));
  try {
    let result: SuiteResult;
    const reusePath = values["reuse-dir"]
      ? resolve(ROOT, values["reuse-dir"], `${id}.json`)
      : undefined;
    if (reusePath && existsSync(reusePath)) {
      result = SuiteResultSchema.parse(await jsonFile(reusePath));
      if (
        result.suite.id !== id ||
        result.gitSha !== gitSha ||
        result.selection.sample !== undefined
      )
        throw new Error("imported_result_mismatch");
    } else if (id === "E5" && values["e5-result"]) {
      const imported = SummarySchema.parse(await jsonFile(resolve(ROOT, values["e5-result"])));
      const match = imported.suites.find((item) => item.suite.id === "E5");
      result = SuiteResultSchema.parse(match);
      if (result.gitSha !== gitSha) throw new Error("e5_result_revision_mismatch");
    } else {
      const adapter = await definitionFor(id);
      close = adapter.close;
      result = await runSuite(adapter.definition, {
        modelVersion: modelVersion(id),
        gitSha,
        seed: BASELINE_CONFIG.seed,
        concurrency: id === "E4" ? E4_CONFIG.concurrency : BASELINE_CONFIG.concurrency,
        timeoutMs: id === "E4" ? E4_CONFIG.timeoutMs : BASELINE_CONFIG.timeoutMs,
        retries: 0,
        ...(sample === undefined ? {} : { sample }),
      });
    }
    results.push(result);
    console.info(
      JSON.stringify({
        event: "suite_finished",
        suite: id,
        counts: result.counts,
        metrics: result.metrics,
        verdict: result.gateVerdict,
      }),
    );
  } catch {
    // Do not export raw provider, database or environment errors.
    gaps.push({
      suite: id,
      reason:
        "suite_setup_failed; inspect configuration, service availability and gold leakage checks",
    });
    console.error(JSON.stringify({ event: "suite_unavailable", suite: id }));
  } finally {
    await close?.();
  }
  await exportResults(results, out);
}
await exportResults(results, out);
await mkdir(dirname(out), { recursive: true });
await writeFile(
  resolve(dirname(out), "coverage.json"),
  `${JSON.stringify(
    {
      gitSha,
      requested,
      importedFrom: values["reuse-dir"] ?? null,
      gaps,
      notes: {
        E1: "Existing test coverage, not exhaustive enumeration of every process path or persistence integration.",
        E11: "Evaluation-only model probe; provisional vocabulary is not wired into production process slots.",
        E12: "Strict full-quote/page/type matching; synthetic line geometry; physical gold bounding boxes unavailable.",
        E13: "Auto text/vector/vision production detection; exact normalized label and owner required.",
      },
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.info(JSON.stringify({ event: "baseline_coverage", gaps }));
process.exitCode =
  gaps.length ||
  results.some(
    (result) =>
      result.counts.errors ||
      (result.suite.gate.kind === "blocking" && result.gateVerdict !== "passed"),
  )
    ? 1
    : 0;
