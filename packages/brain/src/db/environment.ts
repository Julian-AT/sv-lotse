import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Explicitly used by CLI/test entrypoints; importing a client never loads a file.
// Node preserves environment variables supplied by the WP pipeline or deployment.
export function loadLocalEnvironment(): void {
  const path = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
  if (existsSync(path)) loadEnvFile(path);
}
