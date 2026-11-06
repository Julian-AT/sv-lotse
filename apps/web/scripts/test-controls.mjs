import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { loadCatalog, loadKnowledge } from "@lotse/knowledge";
import { loadLocalEnvironment } from "./load-env.mjs";

/** Real services and the sourced catalog, isolated from other workers' cases and migrations. */
async function main() {
  loadLocalEnvironment();
  const admin = createDatabase();
  const name = `lotse_controls_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(admin.config.DATABASE_URL);
  url.pathname = `/${name}`;
  const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
  let created = false;
  try {
    await admin.sql`CREATE DATABASE ${admin.sql(name)}`;
    created = true;
    await migrateDatabase(database);
    await loadCatalog(database, await loadKnowledge());
    process.stdout.write("Audit database migrated and sourced catalog loaded.\n");
    const child = spawn(
      "bun",
      ["run", "e2e", "--config", "playwright.controls.config.ts", ...process.argv.slice(2)],
      { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "inherit" },
    );
    process.exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await database.close();
    if (created) await admin.sql`DROP DATABASE ${admin.sql(name)} WITH (FORCE)`;
    await admin.close();
  }
}

main().catch((error) => {
  // Never print driver errors, SQL, connection strings or user content.
  process.stderr.write(`Controls audit failed (${error.name}); check local services.\n`);
  process.exitCode = 1;
});
