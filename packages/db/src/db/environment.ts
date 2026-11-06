import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Called only by CLI and test entrypoints, so importing a client never reads a file.
// Variables already set in the environment take precedence over the file.
export function loadLocalEnvironment(): void {
  const path = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
  if (existsSync(path)) loadEnvFile(path);
}
