import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { loadLocalEnvironment } from "./load-env.mjs";

let phase = "configuration";

/** Each browser run gets its own real database; never seed or prune the shared catalog. */
async function main() {
  loadLocalEnvironment();
  const admin = createDatabase();
  const name = `lotse_form_stream_e2e_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(admin.config.DATABASE_URL);
  url.pathname = `/${name}`;
  const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
  let created = false;
  try {
    phase = "database creation";
    await admin.sql`CREATE DATABASE ${admin.sql(name)}`;
    created = true;
    phase = "database migration";
    await migrateDatabase(database);
    phase = "browser test";
    const child = spawn("bun", ["run", "e2e", "--config", "playwright.form-stream.config.ts"], {
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

main().catch((error) => {
  process.stderr.write(
    `Recorded form stream tests failed during ${phase} (${error instanceof Error ? error.name : "UNKNOWN"}).\n`,
  );
  process.exitCode = 1;
});
