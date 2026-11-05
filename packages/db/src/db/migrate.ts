import { createDatabase } from "./client.ts";
import { loadLocalEnvironment } from "./environment.ts";
import { migrateDatabase } from "./migrations.ts";

loadLocalEnvironment();

async function main(): Promise<void> {
  const database = createDatabase();
  try {
    await migrateDatabase(database);
    process.stdout.write("Database migrations applied.\n");
  } finally {
    await database.close();
  }
}

main().catch(() => {
  // Driver errors may include connection strings or statement parameters.
  process.stderr.write(
    "Database migration failed; check configuration and database availability.\n",
  );
  process.exitCode = 1;
});
