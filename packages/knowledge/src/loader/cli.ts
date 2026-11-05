import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@lotse/brain/db";
import { loadCatalog } from "./db.ts";
import { KnowledgeError, loadKnowledge } from "./index.ts";

async function main(): Promise<void> {
  const envFile = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
  if (existsSync(envFile)) loadEnvFile(envFile);
  const knowledge = await loadKnowledge(process.argv[2]);
  const database = createDatabase();
  try {
    await loadCatalog(database, knowledge);
    process.stdout.write("Catalog loaded.\n");
  } finally {
    await database.close();
  }
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof KnowledgeError
      ? `${error.message}\n`
      : "Catalog load failed; check configuration and database availability.\n",
  );
  process.exitCode = 1;
});
