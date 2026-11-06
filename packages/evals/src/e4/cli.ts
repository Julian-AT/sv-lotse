import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { parseBrainConfig } from "@lotse/brain/config";
import { createDatabase } from "@lotse/db";
import { z } from "zod";
import { ROOT } from "../baseline/data.ts";
import { E4_CONFIG, readModelConfig } from "../config.ts";
import { exportResults } from "../export.ts";
import { runSuite } from "../runner/index.ts";
import { loadScenarios, ScenarioSchema } from "./data.ts";
import { createE4Suite, type E4Diagnostic } from "./index.ts";

Object.defineProperty(globalThis, "AI_SDK_LOG_WARNINGS", { value: false, configurable: true });
const environment = resolve(ROOT, ".env.local");
if (existsSync(environment)) loadEnvFile(environment);
const { values } = parseArgs({
  options: {
    scenarios: { type: "string", default: "s3" },
    sample: { type: "string" },
    subset: { type: "string" },
    concurrency: { type: "string", default: String(E4_CONFIG.concurrency) },
    timeout: { type: "string", default: String(E4_CONFIG.timeoutMs) },
    seed: { type: "string", default: "e4-2026-11-06" },
    out: { type: "string", default: E4_CONFIG.defaultOutput },
  },
});
let database: ReturnType<typeof createDatabase> | undefined;
try {
  const scenarios = z.array(ScenarioSchema).min(1).parse(values.scenarios.split(","));
  if (new Set(scenarios).size !== scenarios.length) throw new Error("duplicate_scenarios");
  const config = parseBrainConfig();
  const models = readModelConfig();
  const data = await loadScenarios(scenarios);
  database = createDatabase();
  const [corpus] =
    await database.sql`select (select count(*)::int from benefit) as benefits, (select count(*)::int from process) as processes, (select count(*)::int from kb_chunk) as chunks`;
  const out = resolve(ROOT, values.out);
  await mkdir(dirname(out), { recursive: true });
  const diagnostics: E4Diagnostic[] = [];
  let checkpoint = Promise.resolve();
  // Checkpoints after every scored run preserve useful evidence during long live batches.
  const suite = createE4Suite(data, database, config, async (diagnostic) => {
    diagnostics.push(diagnostic);
    const serialized = `${JSON.stringify({ adapterVersion: E4_CONFIG.version, corpus, runs: diagnostics }, null, 2)}\n`;
    checkpoint = checkpoint.then(() =>
      writeFile(resolve(dirname(out), "diagnostics.json"), serialized, { mode: 0o600 }),
    );
    await checkpoint;
    console.info(
      JSON.stringify({
        event: "e4_case_scored",
        caseId: diagnostic.caseId,
        status: diagnostic.personaStatus,
        turns: diagnostic.turns,
        baselineCount: diagnostic.questionBaselines,
      }),
    );
  });
  console.info(
    JSON.stringify({ event: "e4_started", scenarios, corpus, caseCount: suite.cases.length }),
  );
  const result = await runSuite(suite, {
    gitSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    modelVersion: `${E4_CONFIG.version};orchestrator=${config.models.orchestrator.primary};classifier=${config.models.classifier.primary};guard=${config.models.guard.primary};extractor=${config.models.extractor.primary};persona=${models.EVAL_PERSONA_MODEL};judge=${models.EVAL_JUDGE_MODEL}`,
    concurrency: Number(values.concurrency),
    timeoutMs: Number(values.timeout),
    retries: 0,
    seed: values.seed,
    ...(values.sample ? { sample: Number(values.sample) } : {}),
    ...(values.subset ? { subset: z.enum(["pr", "nightly", "weekly"]).parse(values.subset) } : {}),
  });
  await exportResults([result], out);
  console.info(
    JSON.stringify({
      event: "e4_finished",
      counts: result.counts,
      metrics: result.metrics,
      wilson95: result.wilson95,
      gateVerdict: result.gateVerdict,
    }),
  );
  process.exitCode = result.counts.errors ? 1 : 0;
} catch {
  console.error(
    JSON.stringify({
      event: "e4_evaluation_failed",
      reason: "Check configuration, real services, dataset leakage and output permissions.",
    }),
  );
  process.exitCode = 2;
} finally {
  await database?.close();
}
