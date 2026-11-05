import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const environment = new URL("../../../.env.local", import.meta.url);
if (existsSync(environment)) loadEnvFile(fileURLToPath(environment));
if (process.env.RUN_LIVE === "1") {
  const require = createRequire(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"), "run", "test/live"],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} else {
  console.info("Live evaluations disabled; set RUN_LIVE=1 to call OpenAI.");
}
