import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { loadLocalEnvironment } from "./load-env.mjs";

loadLocalEnvironment();
const admin = createDatabase();
const databaseName = `lotse_relatives_e2e_${randomUUID().replaceAll("-", "")}`;
const url = new URL(admin.config.DATABASE_URL);
url.pathname = `/${databaseName}`;
const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
let created = false;
let status = 1;
try {
  await admin.sql`CREATE DATABASE ${admin.sql(databaseName)}`;
  created = true;
  await migrateDatabase(database);
  status = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.resolve("@playwright/test/cli")),
        "test",
        "--config",
        "playwright.relatives.config.ts",
      ],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} catch {
  process.stderr.write(
    "Relatives browser verification failed; check local service availability.\n",
  );
} finally {
  await database.close();
  if (created) await admin.sql`DROP DATABASE ${admin.sql(databaseName)} WITH (FORCE)`;
  await admin.close();
}
process.exitCode = status;
