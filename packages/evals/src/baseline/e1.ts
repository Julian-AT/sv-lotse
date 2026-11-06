import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { RegisteredSuite } from "../runner/index.ts";
import { ROOT } from "./data.ts";

const reportSchema = z.object({
  testResults: z.array(
    z.object({
      assertionResults: z.array(
        z.object({
          fullName: z.string(),
          status: z.string(),
        }),
      ),
    }),
  ),
});
export async function e1Suite(): Promise<RegisteredSuite> {
  const directory = await mkdtemp(join(tmpdir(), "lotse-engine-eval-"));
  try {
    const output = join(directory, "vitest.json");
    const require = createRequire(import.meta.url);
    const cli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          "run",
          "test/engine/engine.test.ts",
          "test/engine/catalog.test.ts",
          "test/forms/runtime/policy.test.ts",
          "--reporter=json",
          `--outputFile=${output}`,
        ],
        {
          cwd: join(ROOT, "packages/brain"),
          stdio: "ignore",
        },
      );
      child.once("error", reject);
      child.once("exit", () => resolve());
    });
    const report = reportSchema.parse(JSON.parse(await readFile(output, "utf8")));
    const assertions = report.testResults.flatMap((result) => result.assertionResults);
    if (!assertions.length) throw new Error("engine_tests_missing");
    return {
      suite: {
        id: "E1",
        name: "Existing deterministic engine/catalog/form-policy tests",
        minimumSetSize: assertions.length,
        gate: { kind: "blocking", metric: "passRate", threshold: 1, direction: "at_least" },
      },
      cases: assertions.map((assertion, index) => ({
        id: `engine-${index + 1}`,
        kind: "synthetic",
        tags: ["pr", "nightly", "weekly"],
        input: { test: assertion.fullName, status: assertion.status },
        expected: "passed",
      })),
      async execute(item) {
        const { status } = z.object({ status: z.string() }).parse(item.input);
        return { passed: status === "passed", metrics: {} };
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
