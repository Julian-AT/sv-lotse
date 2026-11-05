import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

/** CLI/test entrypoints only; importing the loader never changes the environment. */
export function loadSozdokEnvironment(): void {
  const path = fileURLToPath(new URL("../../../../../.env.local", import.meta.url));
  if (existsSync(path)) loadEnvFile(path);
}
