import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadLocalEnvironment } from "./load-env.mjs";

export const serverEnvironmentNames = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "DATABASE_URL",
  "DATABASE_POOL_SIZE",
  "SESSION_SECRET",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "OPENAI_API_KEY",
  "APPROVAL_HMAC_SECRET",
  "CRON_SECRET",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
  "S3_PREFIX",
  "LOTSE_WORKSPACE_URL",
  "SVBOX_DIR",
  "LOTSE_CASE_BUDGET_USD",
  "LOTSE_MODEL_PRICING_JSON",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
  "POSTHOG_KEY",
  "POSTHOG_HOST",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID_DE",
  "ELEVENLABS_VOICE_ID_EN",
];

export async function checkClientEnvironment(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkClientEnvironment(path);
    else {
      const content = await readFile(path, "utf8");
      if (
        serverEnvironmentNames.some(
          (name) =>
            content.includes(name) ||
            (process.env[name]?.length >= 16 && content.includes(process.env[name])),
        )
      ) {
        throw new Error("Server environment found in client build");
      }
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadLocalEnvironment();
  await checkClientEnvironment(fileURLToPath(new URL("../.next/static", import.meta.url)));
  process.stdout.write("Client bundles contain no server environment names or secret values.\n");
}
