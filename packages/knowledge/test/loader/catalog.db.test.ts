import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDatabase } from "@lotse/brain/db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { loadCatalog } from "../../src/loader/db.ts";
import { loadKnowledge } from "../../src/loader/index.ts";
import { fixtureRoot, form, removeFixture } from "./fixtures.ts";

const envFile = fileURLToPath(new URL("../../../../.env.local", import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);
const database = createDatabase({ ...process.env, DATABASE_POOL_SIZE: "1" });
const namespace = `knowledge_${randomUUID().replaceAll("-", "")}`;
let root: string;
beforeAll(async () => {
  await database.sql`CREATE SCHEMA ${database.sql(namespace)}`;
  await database.sql`SET search_path TO ${database.sql(namespace)}, public`;
  for (const table of ["benefit", "office", "facility", "process", "form_template"]) {
    await database.sql`CREATE TABLE ${database.sql(table)} (LIKE public.${database.sql(table)} INCLUDING ALL)`;
  }
  await database.sql`ALTER TABLE process ADD FOREIGN KEY (benefit_id) REFERENCES benefit(id) ON DELETE RESTRICT`;
  root = await fixtureRoot();
});
afterAll(async () => {
  try {
    await database.sql`DROP SCHEMA IF EXISTS ${database.sql(namespace)} CASCADE`;
    if (root) await removeFixture(root);
  } finally {
    await database.close();
  }
});
test("AC2 loads real Postgres idempotently, updates verified templates and removes absent catalog rows", async () => {
  await database.sql`INSERT INTO form_template (id, publisher, title, source, hash, format, pages, schema, storage_key)
    VALUES (${form.template_id}, 'Fixture publisher', 'Fixture application', 'https://example.org/form.pdf', 'fixture-hash', 'acroform', 1, '{}', 'fixture/form.pdf')`;
  const url = new URL(database.config.DATABASE_URL);
  url.searchParams.set("search_path", `${namespace},public`);
  const execute = promisify(execFile);
  const cli = fileURLToPath(new URL("../../src/loader/cli.ts", import.meta.url));
  async function runCatalogCli() {
    const { stdout, stderr } = await execute("bun", [cli, root], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      timeout: 10000,
    });
    expect(stdout).toContain("Catalog loaded.");
    expect(stderr).toBe("");
  }
  await runCatalogCli();
  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const table of ["benefit", "office", "facility", "process", "form_template"]) {
      result[table] =
        await database.sql`SELECT to_jsonb(t) AS record, xmin::text AS version FROM ${database.sql(table)} t ORDER BY id`;
    }
    return result;
  }
  const first = await snapshot();
  for (const rows of Object.values(first)) expect(rows).toHaveLength(1);
  const [stored] =
    await database.sql`SELECT schema, status FROM form_template WHERE id = ${form.template_id}`;
  expect(stored?.schema).toEqual(form);
  expect(stored?.status).toBe("verified");
  expect(
    await database.sql`SELECT p.id FROM process p JOIN benefit b ON p.benefit_id = b.id WHERE b.key = 'fixture-benefit'`,
  ).toHaveLength(1);
  await runCatalogCli();
  expect(await snapshot()).toEqual(first);
  for (const directory of ["catalog", "processes", "offices", "facilities"])
    await rm(join(root, directory), { recursive: true });
  await runCatalogCli();
  for (const table of ["benefit", "office", "facility", "process"])
    expect(await database.sql`SELECT id FROM ${database.sql(table)}`).toHaveLength(0);
  expect(await database.sql`SELECT id FROM form_template`).toHaveLength(1);
});

test("AC2 rolls back the complete snapshot when a catalog write fails", async () => {
  const { writeFile } = await import("node:fs/promises");
  const { stringify } = await import("yaml");
  const { benefit, facility } = await import("./fixtures.ts");
  const transactionRoot = await fixtureRoot();
  try {
    await loadCatalog(database, await loadKnowledge(transactionRoot));
    const before =
      await database.sql`SELECT key, record, xmin::text AS version FROM benefit ORDER BY key`;
    await database.sql`ALTER TABLE facility ADD CONSTRAINT fixture_reject_title CHECK (title <> 'Rejected')`;
    await writeFile(
      join(transactionRoot, "catalog/benefit.yaml"),
      stringify({ ...benefit, name_de: "Changed" }),
    );
    await writeFile(
      join(transactionRoot, "facilities/facility.yaml"),
      stringify({ ...facility, name_de: "Rejected" }),
    );
    await expect(loadCatalog(database, await loadKnowledge(transactionRoot))).rejects.toMatchObject(
      { code: "23514" },
    );
    expect(
      await database.sql`SELECT key, record, xmin::text AS version FROM benefit ORDER BY key`,
    ).toEqual(before);
  } finally {
    await removeFixture(transactionRoot);
  }
});
