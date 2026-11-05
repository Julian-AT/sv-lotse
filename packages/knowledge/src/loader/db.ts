import type { Database } from "@lotse/brain/db";
import type { Knowledge } from "./index.ts";

// Catalog tables are a repository-owned mirror. Form templates are acquired assets:
// only their reviewed schemas are updated; originals and instances are retained.
export async function loadCatalog(database: Database, knowledge: Knowledge): Promise<void> {
  await database.sql.begin(async (sql) => {
    // Serialize repository snapshots so concurrent loads cannot interleave pruning.
    await sql`SELECT pg_advisory_xact_lock(101, 1)`;
    for (const record of Object.values(knowledge.catalog)) {
      await sql`INSERT INTO benefit (key, title, category, carrier, record)
        VALUES (${record.id}, ${record.name_de}, ${record.area}, ${record.carriers.length === 1 ? (record.carriers[0] ?? null) : null}, ${JSON.stringify(record)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, category = EXCLUDED.category,
          carrier = EXCLUDED.carrier, record = EXCLUDED.record
        WHERE benefit.record IS DISTINCT FROM EXCLUDED.record`;
    }
    for (const record of Object.values(knowledge.offices)) {
      await sql`INSERT INTO office (key, title, carrier, region, record)
        VALUES (${record.id}, ${record.name_de}, ${record.carrier ?? null}, ${record.region ?? null}, ${JSON.stringify(record)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, carrier = EXCLUDED.carrier,
          region = EXCLUDED.region, record = EXCLUDED.record
        WHERE office.record IS DISTINCT FROM EXCLUDED.record`;
    }
    for (const record of Object.values(knowledge.facilities)) {
      await sql`INSERT INTO facility (key, title, type, region, record)
        VALUES (${record.id}, ${record.name_de}, ${record.type}, ${record.region ?? null}, ${JSON.stringify(record)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, type = EXCLUDED.type,
          region = EXCLUDED.region, record = EXCLUDED.record
        WHERE facility.record IS DISTINCT FROM EXCLUDED.record`;
    }
    for (const record of Object.values(knowledge.processes)) {
      const benefitKey = record.benefit.slice("ref:catalog/".length);
      await sql`INSERT INTO process (key, title, benefit_id, record)
        VALUES (${record.id}, ${record.id}, (SELECT id FROM benefit WHERE key = ${benefitKey}), ${JSON.stringify(record)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, benefit_id = EXCLUDED.benefit_id, record = EXCLUDED.record
        WHERE process.record IS DISTINCT FROM EXCLUDED.record OR process.benefit_id IS DISTINCT FROM EXCLUDED.benefit_id`;
    }
    for (const record of Object.values(knowledge.forms)) {
      await sql`UPDATE form_template SET schema = ${JSON.stringify(record)}::jsonb, status = 'verified'
        WHERE id = ${record.template_id}::uuid AND (schema IS DISTINCT FROM ${JSON.stringify(record)}::jsonb OR status <> 'verified')`;
    }
    // Processes must be removed before benefits because benefit_id is RESTRICT.
    for (const [table, records] of [
      ["process", knowledge.processes],
      ["benefit", knowledge.catalog],
      ["office", knowledge.offices],
      ["facility", knowledge.facilities],
    ] as const) {
      await sql`DELETE FROM ${sql(table)} WHERE NOT (key = ANY(${Object.keys(records)}::text[]))`;
    }
  });
}
