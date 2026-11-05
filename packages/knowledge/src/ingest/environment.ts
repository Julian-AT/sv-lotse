import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Entrypoints opt in; importing the pipeline never reads environment files.
export function loadEnvironment(): void {
  const path = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
  if (existsSync(path)) loadEnvFile(path);
}
