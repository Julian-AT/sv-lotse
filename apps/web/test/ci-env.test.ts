import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createCiEnvironment } from "../scripts/ci-env.mjs";
import { loadLocalEnvironment } from "../scripts/load-env.mjs";
import { parseEnvironment } from "../src/server/env.ts";

afterEach(() => vi.unstubAllEnvs());

test("CI provisions validated compose configuration and a fresh disposable signing key without a local env file", () => {
  const defaults = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  const first = createCiEnvironment(defaults);
  const second = createCiEnvironment(defaults);
  expect(parseEnvironment(first).DATABASE_URL).toBe(first.DATABASE_URL);
  expect(first.SESSION_SECRET).toHaveLength(64);
  expect(first.SESSION_SECRET).not.toBe(second.SESSION_SECRET);
  expect(() => createCiEnvironment("DATABASE_URL=invalid")).toThrow(/DATABASE_URL.*S3_ENDPOINT/);
  expect(first).not.toHaveProperty("OPENAI_API_KEY");
});

test("environment-only commands tolerate a missing env file and retain supplied values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lotse-env-"));
  const path = join(directory, ".env.local");
  vi.stubEnv("LOTSE_ENV_LOADER_TEST", "supplied");
  try {
    expect(() => loadLocalEnvironment(path)).not.toThrow();
    await writeFile(path, "LOTSE_ENV_LOADER_TEST=local-file\n");
    loadLocalEnvironment(path);
    expect(process.env.LOTSE_ENV_LOADER_TEST).toBe("supplied");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
