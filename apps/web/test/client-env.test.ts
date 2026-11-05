import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkClientEnvironment } from "../scripts/check-client-env.mjs";

test("AC6 client bundle scanner rejects server environment names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lotse-client-env-"));
  try {
    await writeFile(join(directory, "client.js"), 'const label = "SV KI-Lotse"');
    await expect(checkClientEnvironment(directory)).resolves.toBeUndefined();
    await writeFile(join(directory, "client.js"), "const key = process.env.SESSION_SECRET");
    await expect(checkClientEnvironment(directory)).rejects.toThrow(
      "Server environment found in client build",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
