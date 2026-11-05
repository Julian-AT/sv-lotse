import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { parseEnvironment } from "../src/server/env.ts";

const composeKeys = [
  "DATABASE_URL",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
];

export function createCiEnvironment(source) {
  const defaults = parseEnv(source);
  const values = Object.fromEntries(composeKeys.map((key) => [key, defaults[key]]));
  const config = parseEnvironment({ ...values, SESSION_SECRET: randomBytes(32).toString("hex") });
  return Object.fromEntries([...composeKeys, "SESSION_SECRET"].map((key) => [key, config[key]]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.GITHUB_ENV) throw new Error("Missing GITHUB_ENV");
  const config = createCiEnvironment(
    readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"),
  );
  // Only the runner environment file receives the disposable key; never stdout.
  appendFileSync(
    process.env.GITHUB_ENV,
    `${Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}
