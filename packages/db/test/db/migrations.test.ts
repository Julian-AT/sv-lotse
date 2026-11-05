import { readMigrationFiles } from "drizzle-orm/migrator";
import { expect, test } from "vitest";
import { migrationsFolder } from "../../src/db/migrations.ts";

test("AC4 committed migrations enable only vector and pgcrypto before creating tables", () => {
  const migrations = readMigrationFiles({ migrationsFolder });
  const extensions = migrations.flatMap((migration) =>
    migration.sql.flatMap((statement) =>
      [...statement.matchAll(/CREATE EXTENSION(?: IF NOT EXISTS)?\s+(\w+)/gi)].map(
        (match) => match[1],
      ),
    ),
  );
  expect(extensions.sort()).toEqual(["pgcrypto", "vector"]);
  expect(migrations[0]?.sql.join("\n")).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  expect(migrations[0]?.sql.join("\n")).not.toContain("CREATE TABLE");
  expect(migrations[1]?.sql.join("\n")).toContain('"embedding" vector(1536)');
});
