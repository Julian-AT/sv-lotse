import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { loadLocalEnvironment } from "./load-env.mjs";

/** Each browser run gets its own real database; never seed or prune the shared catalog. */
async function main() {
  loadLocalEnvironment();
  const admin = createDatabase();
  const name = `lotse_workspace_e2e_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(admin.config.DATABASE_URL);
  url.pathname = `/${name}`;
  const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
  let created = false;
  try {
    await admin.sql`CREATE DATABASE ${admin.sql(name)}`;
    created = true;
    await migrateDatabase(database);
    const child = spawn("bun", ["run", "e2e", "--grep", "@workspace"], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: "inherit",
    });
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

main().catch(() => {
  process.stderr.write("Workspace browser tests failed; check service and browser availability.\n");
  process.exitCode = 1;
});
