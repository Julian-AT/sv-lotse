import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export function loadLocalEnvironment(
  path = fileURLToPath(new URL("../../../.env.local", import.meta.url)),
) {
  if (existsSync(path)) loadEnvFile(path);
}
