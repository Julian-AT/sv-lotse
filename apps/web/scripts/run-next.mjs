import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadLocalEnvironment } from "./load-env.mjs";

loadLocalEnvironment();
// Validate after loading local environment, so it cannot silently enable build fixtures.
if (process.argv[2] === "build") {
  const check = spawnSync("bun", ["run", "--filter", "@lotse/knowledge", "e2:scan"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: "inherit",
    env: process.env,
  });
  if (check.status !== 0) process.exit(check.status ?? 1);
}
const cli = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
