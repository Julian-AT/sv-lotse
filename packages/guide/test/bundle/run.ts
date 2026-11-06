import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlaywrightTestConfig } from "@playwright/test";

const configuration = {
  testDir: fileURLToPath(new URL("./", import.meta.url)),
  testMatch: "runtime.spec.ts",
  outputDir: fileURLToPath(new URL("../../test-results/bundle/", import.meta.url)),
  workers: 1,
  use: {
    browserName: "chromium",
    viewport: { width: 1000, height: 800 },
  },
} satisfies PlaywrightTestConfig;

// Match the existing E8 runner: Playwright requires a mutable default export.
const directory = await mkdtemp(join(tmpdir(), "lotse-guide-bundle-"));
try {
  const path = join(directory, "playwright.config.mjs");
  await writeFile(path, `export default ${JSON.stringify(configuration)};\n`);
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
