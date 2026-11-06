import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const environment = new URL("../../../../.env.local", import.meta.url);
if (existsSync(environment)) loadEnvFile(fileURLToPath(environment));
if (process.env.RUN_LIVE === "1") {
  const require = createRequire(import.meta.url);
  const filters = process.argv.slice(2).filter((argument) => argument !== "--");
  const findTests = (folder) =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      return entry.isDirectory() ? findTests(path) : path.endsWith(".live.test.ts") ? [path] : [];
    });
  const tests = findTests("test").filter(
    (test) => filters.length === 0 || filters.some((filter) => test.includes(filter)),
  );
  if (tests.length === 0) throw new Error("No live tests match the requested filter");
  const result = spawnSync(
    process.execPath,
    [
      join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
      "run",
      ...tests,
      "--hookTimeout=30000",
      "--testTimeout=180000",
    ],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} else {
  console.info("Live tests disabled; set RUN_LIVE=1 to call OpenAI.");
}
