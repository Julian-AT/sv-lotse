import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";

async function main() {
  const database = createDatabase();
  try {
    await migrateDatabase(database);
  } finally {
    await database.close();
  }
}
main().catch(() => {
  process.stderr.write(
    "Database migration failed; check configuration and database availability.\n",
  );
  process.exitCode = 1;
});
