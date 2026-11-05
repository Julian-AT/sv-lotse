import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as configuration from "../playwright.config.ts";

// Playwright mutates its config object; ESM named-export namespaces are immutable.
// Materialize its required default export without adding one to repository source.
const directory = await mkdtemp(join(tmpdir(), "lotse-guide-e2e-"));
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  const path = join(directory, "playwright.config.mjs");
  await writeFile(
    path,
    `export default ${JSON.stringify({
      ...configuration,
      testDir: join(root, configuration.testDir),
      outputDir: join(root, "test-results"),
      webServer: { ...configuration.webServer, cwd: root },
    })};\n`,
  );
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@playwright/test/cli")),
      "test",
      "--config",
      path,
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
