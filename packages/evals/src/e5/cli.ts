import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { parseBrainConfig } from "@lotse/brain/config";
import { GUARD_CONFIG } from "@lotse/brain/guards";
import { runCli } from "../cli.ts";
import { Registry } from "../runner/index.ts";
import { createLiveE5Adapter } from "./adapter.ts";
import { createE5Suite } from "./index.ts";
import { E5_JUDGE_VERSION } from "./judge.ts";

const environment = new URL("../../../../.env.local", import.meta.url);
if (existsSync(environment)) loadEnvFile(fileURLToPath(environment));
try {
  const registry = new Registry();
  registry.register(
    createE5Suite(
      JSON.parse(await readFile(new URL("../../sets/e5/cases.json", import.meta.url), "utf8")),
      JSON.parse(await readFile(new URL("../../sets/e5/suite.json", import.meta.url), "utf8")),
      createLiveE5Adapter(),
    ),
  );
  const config = parseBrainConfig();
  process.exitCode = await runCli(
    process.argv.slice(2),
    registry,
    `brain-text/${config.models.orchestrator.primary};guard/${config.models.guard.primary};${GUARD_CONFIG.version};judge/${config.models.guard.primary}/${E5_JUDGE_VERSION}`,
  );
  const outIndex = process.argv.indexOf("--out");
  const out = process.argv[outIndex + 1];
  if (outIndex >= 0 && out) {
    const { SummarySchema } = await import("../schema/index.ts");
    const summary = SummarySchema.parse(JSON.parse(await readFile(out, "utf8")));
    for (const suite of summary.suites)
      console.info(
        JSON.stringify({
          suite: suite.suite.id,
          counts: suite.counts,
          metrics: suite.metrics,
          gateVerdict: suite.gateVerdict,
          modelVersion: suite.modelVersion,
        }),
      );
  }
} catch {
  console.error(JSON.stringify({ event: "e5_evaluation_failed" }));
  process.exitCode = 2;
}
