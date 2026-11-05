import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createDemoSuite } from "./demo.ts";
import { exportResults } from "./export.ts";
import { Registry, runSuite } from "./runner/index.ts";
import { SubsetSchema, SuiteIdSchema } from "./schema/index.ts";

const CliSchema = z.object({
  suite: z.union([SuiteIdSchema, z.literal("all")]).default("all"),
  subset: SubsetSchema.optional(),
  sample: z.coerce.number().int().nonnegative().optional(),
  seed: z.string().min(1).default("0"),
  out: z.string().min(1),
  concurrency: z.coerce.number().int().min(1).max(100).default(4),
  timeout: z.coerce.number().int().positive().default(60_000),
  retries: z.coerce.number().int().min(0).max(10).default(2),
});

/** Registry injection lets later suites reuse exactly the same CLI and exit policy. */
export async function runCli(
  args: string[],
  registry: Registry,
  modelVersion = "arithmetic-v1",
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(
      ["suite", "subset", "sample", "seed", "out", "concurrency", "timeout", "retries"].map(
        (key) => [key, { type: "string" as const }],
      ),
    ),
  });
  if (positionals.length !== 1 || positionals[0] !== "run")
    throw new Error("Expected: run --suite E1 --out results/summary.json");
  const options = CliSchema.parse(values);
  const definitions = options.suite === "all" ? registry.list() : [registry.get(options.suite)];
  if (definitions.length === 0) throw new Error("No suites registered");
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const results = [];
  for (const definition of definitions) {
    results.push(
      await runSuite(definition, { ...options, timeoutMs: options.timeout, modelVersion, gitSha }),
    );
  }
  await exportResults(results, options.out);
  return results.some(
    (result) => result.suite.gate.kind === "blocking" && result.gateVerdict !== "passed",
  )
    ? 1
    : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const registry = new Registry();
  registry.register(createDemoSuite());
  try {
    process.exitCode = await runCli(process.argv.slice(2), registry);
  } catch {
    console.error(JSON.stringify({ event: "evaluation_cli_failed" }));
    process.exitCode = 2;
  }
}
