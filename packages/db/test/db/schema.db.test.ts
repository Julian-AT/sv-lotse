import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { consumeApproval } from "../../src/db/approvals.ts";
import { createDatabase } from "../../src/db/client.ts";
import { loadLocalEnvironment } from "../../src/db/environment.ts";
import { migrateDatabase, migrationsFolder } from "../../src/db/migrations.ts";
import * as schema from "../../src/db/schema/index.ts";
import { seedEntities } from "./seed.ts";

loadLocalEnvironment();

const committedMigrations = (
  JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  }
).entries.length;

const expectedColumns = {
  user: ["id", "kind", "created_at", "last_seen_at"],
  session: ["id", "user_id", "client_kind", "created_at", "expires_at"],
  subject: ["id", "display_name", "relation_to_user", "created_by"],
  case_actor: ["id", "case_id", "user_id", "role", "share_scope"],
  helper_invite: [
    "id",
    "token_hash",
    "case_id",
    "issuer_id",
    "share_scope",
    "expires_at",
    "consumed_at",
  ],
  profile: [
    "id",
    "user_id",
    "language",
    "register",
    "detail_level",
    "autonomy_level",
    "carrier",
    "region",
    "age_band",
  ],
  case: ["id", "subject_id", "confirmed_goal", "life_situation", "status", "journey_map"],
  case_step: [
    "id",
    "case_id",
    "process_step",
    "status",
    "owner",
    "due_at",
    "linked_artifacts",
    "initiated_by",
  ],
  approval: [
    "id",
    "approval_id",
    "case_id",
    "tool_call_id",
    "tool_name",
    "input_hash",
    "actor_id",
    "session_id",
    "decision",
    "requested_at",
    "decided_at",
    "consumed_at",
    "hmac",
  ],
  message: ["id", "case_id", "position", "ui_message"],
  turn: [
    "id",
    "case_id",
    "message_ids",
    "capsule_digest",
    "segments",
    "tool_calls",
    "action_results",
    "model_ids",
    "timings",
    "status",
  ],
  fact: [
    "id",
    "subject_id",
    "type",
    "value",
    "document_id",
    "turn_id",
    "source_fact_id",
    "source",
    "confidence",
    "confirmed",
  ],
  document: [
    "id",
    "subject_id",
    "type",
    "storage_key",
    "hash",
    "pages",
    "ocr_status",
    "origin_client",
  ],
  benefit: ["id", "key", "title", "category", "carrier", "region", "record"],
  office: ["id", "key", "title", "carrier", "region", "record"],
  facility: ["id", "key", "title", "type", "region", "record"],
  process: ["id", "key", "title", "benefit_id", "record"],
  form_template: [
    "id",
    "publisher",
    "title",
    "source",
    "hash",
    "version_date",
    "retrieved_at",
    "format",
    "pages",
    "status",
    "schema",
    "storage_key",
  ],
  form_instance: ["id", "case_id", "subject_id", "template_id", "fields", "output_key"],
  source: ["id", "url", "title", "publisher", "text", "metadata", "valid_from", "valid_to"],
  kb_chunk: ["id", "source_id", "text", "embedding", "metadata", "valid_from", "valid_to", "tsv"],
  reminder: ["id", "case_id", "due_at", "source"],
  job: ["id", "case_id", "type", "step_state", "status", "attempts"],
  helper_session: ["id", "case_id", "helper_id", "scope", "started_at", "ended_at"],
  audit_event: ["id", "actor_id", "action", "target", "approval_id", "occurred_at"],
};

function consumptionOf(approval: typeof schema.approvals.$inferSelect) {
  return {
    approvalId: approval.approvalId,
    sessionId: approval.sessionId,
    actorId: approval.actorId,
    inputHash: approval.inputHash,
    hmac: approval.hmac,
  };
}

describe("real Postgres schema", () => {
  const admin = createDatabase();
  const databaseName = `lotse_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(admin.config.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
  const db = database.db;
  let created = false;
  let emptyTableCount = -1;
  let entities: Awaited<ReturnType<typeof seedEntities>>;

  beforeAll(async () => {
    await admin.sql`CREATE DATABASE ${admin.sql(databaseName)}`;
    created = true;
    const [count] = await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`;
    emptyTableCount = count?.count ?? -1;
    await migrateDatabase(database);
    entities = await seedEntities(db);
  });

  afterAll(async () => {
    await database.close();
    try {
      if (created) await admin.sql`DROP DATABASE ${admin.sql(databaseName)}`;
    } finally {
      await admin.close();
    }
  });

  test("AC3 applies committed migrations to an empty database and is idempotent", async () => {
    expect(emptyTableCount).toBe(0);
    const before = await database.sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`;
    expect(before).toHaveLength(committedMigrations);
    await migrateDatabase(database);
    expect(await database.sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`).toEqual(
      before,
    );
  });

  test.each(Object.entries(expectedColumns))(
    "AC2 persists the PRD key fields for %s",
    async (table, columns) => {
      const actual = await database.sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}`;
      expect(actual.map((column) => column.column_name)).toEqual(expect.arrayContaining(columns));
      const [primaryKey] = await database.sql<{ udt_name: string; column_default: string }[]>`
        SELECT c.udt_name, c.column_default FROM information_schema.columns c
        JOIN information_schema.key_column_usage k
          USING (table_catalog, table_schema, table_name, column_name)
        JOIN information_schema.table_constraints t
          USING (constraint_catalog, constraint_schema, constraint_name)
        WHERE c.table_schema = 'public' AND c.table_name = ${table}
          AND c.column_name = 'id' AND t.constraint_type = 'PRIMARY KEY'`;
      expect(primaryKey?.udt_name).toBe("uuid");
      expect(primaryKey?.column_default).toBe("gen_random_uuid()");
      const entity = entities[table];
      expect(entity).toBeDefined();
      if (!entity) throw new Error(`Missing round-trip fixture for ${table}`);
      const [stored] = await database.sql<{ record: Record<string, unknown> }[]>`
      SELECT to_jsonb(entity) AS record FROM ${database.sql(table)} entity WHERE id = ${entity.id}`;
      expect(stored?.record).toMatchObject(entity);
    },
  );

  test("AC3 installs the required uniqueness, fact, vector and German search indexes", async () => {
    const indexes = await database.sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const definitions = new Map(indexes.map((index) => [index.indexname, index.indexdef]));
    expect(definitions.get("approval_approval_id_unique")).toMatch(/UNIQUE.*\(approval_id\)/);
    expect(definitions.get("message_case_position_unique")).toMatch(
      /UNIQUE.*\(case_id, "position"\)/,
    );
    expect(definitions.get("fact_subject_type_idx")).toContain("(subject_id, type)");
    expect(definitions.get("kb_chunk_embedding_hnsw_idx")).toMatch(
      /USING hnsw \(embedding vector_cosine_ops\)/,
    );
    expect(definitions.get("kb_chunk_tsv_gin_idx")).toMatch(/USING gin \(tsv\)/);
    const [vector] = await database.sql<{ type: string }[]>`
      SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
      WHERE attrelid = 'kb_chunk'::regclass AND attname = 'embedding'`;
    expect(vector?.type).toBe("vector(1536)");
    const [generated] = await database.sql<
      { is_generated: string; generation_expression: string }[]
    >`
      SELECT is_generated, generation_expression FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'kb_chunk' AND column_name = 'tsv'`;
    expect(generated?.is_generated).toBe("ALWAYS");
    expect(generated?.generation_expression).toContain("'german'::regconfig");
  });

  test("helper invites enforce unique hashes and valid expiry times", async () => {
    const invite = entities.helper_invite;
    const caseEntity = entities.case;
    const user = entities.user;
    if (!invite || !caseEntity || !user) throw new Error("Missing invite fixture");
    const base = {
      caseId: caseEntity.id,
      issuerId: user.id,
      shareScope: { mode: "full" },
      expiresAt: new Date(Date.now() + 60_000),
    };
    await expect(
      db.insert(schema.helperInvites).values({
        ...base,
        tokenHash: String(invite.token_hash),
      }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "helper_invite_token_hash_unique" },
    });
    await expect(
      db.insert(schema.helperInvites).values({
        ...base,
        tokenHash: "invalid",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "helper_invite_token_hash_check" },
    });
    await expect(
      db.insert(schema.helperInvites).values({
        ...base,
        tokenHash: randomUUID().replaceAll("-", "").repeat(2),
        expiresAt: new Date(0),
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "helper_invite_expiry_check" },
    });
  });

  test("AC3 rejects duplicate approval ids and case message positions", async () => {
    const approval = entities.approval;
    const message = entities.message;
    if (!approval || !message) throw new Error("Missing uniqueness fixtures");
    await expect(database.sql`
      INSERT INTO approval SELECT (jsonb_populate_record(NULL::approval,
        to_jsonb(a) || jsonb_build_object('id', gen_random_uuid()))).* FROM approval a WHERE id = ${approval.id}`).rejects.toMatchObject(
      { code: "23505" },
    );
    await expect(database.sql`
      INSERT INTO message SELECT (jsonb_populate_record(NULL::message,
        to_jsonb(m) || jsonb_build_object('id', gen_random_uuid()))).* FROM message m WHERE id = ${message.id}`).rejects.toMatchObject(
      { code: "23505" },
    );
  });

  test("AC3 rejects audit UPDATE and DELETE while allowing INSERT", async () => {
    const event = entities.audit_event;
    if (!event) throw new Error("Missing audit fixture");
    await expect(
      database.sql`UPDATE audit_event SET action = 'changed' WHERE id = ${event.id}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      database.sql`DELETE FROM audit_event WHERE id = ${event.id}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(database.sql`TRUNCATE audit_event`).rejects.toMatchObject({ code: "55000" });
    expect(await database.sql`SELECT id FROM audit_event WHERE id = ${event.id}`).toHaveLength(1);
  });

  test("FR-A2 consumes an approved row once even when two requests race", async () => {
    const row = entities.approval;
    if (!row) throw new Error("Missing approval fixture");
    const [approval] = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, row.id));
    if (!approval) throw new Error("Missing approval fixture");
    const expected = consumptionOf(approval);
    expect(await consumeApproval(db, { ...expected, inputHash: "0".repeat(64) })).toHaveLength(0);
    expect(await consumeApproval(db, { ...expected, actorId: randomUUID() })).toHaveLength(0);
    expect(await consumeApproval(db, { ...expected, sessionId: randomUUID() })).toHaveLength(0);
    expect(await consumeApproval(db, { ...expected, hmac: "0".repeat(64) })).toHaveLength(0);
    const results = await Promise.all([
      consumeApproval(db, expected),
      consumeApproval(db, expected),
    ]);
    expect(results.map((rows) => rows.length).sort()).toEqual([0, 1]);
    expect(await consumeApproval(db, expected)).toHaveLength(0);
  });

  test("FR-A2 never consumes a pending or denied approval", async () => {
    const row = entities.approval;
    if (!row) throw new Error("Missing approval fixture");
    const [original] = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, row.id));
    if (!original) throw new Error("Missing approval fixture");
    const [pending] = await db
      .insert(schema.approvals)
      .values({
        ...original,
        id: randomUUID(),
        approvalId: randomUUID(),
        decision: "pending",
        consumedAt: null,
        decidedAt: null,
      })
      .returning();
    if (!pending) throw new Error("Pending approval was not inserted");
    const expected = consumptionOf(pending);
    expect(await consumeApproval(db, expected)).toHaveLength(0);
    await db
      .update(schema.approvals)
      .set({ decision: "denied", decidedAt: new Date() })
      .where(eq(schema.approvals.id, pending.id));
    expect(await consumeApproval(db, expected)).toHaveLength(0);
  });

  test("AC3 round-trips the embedding through the pgvector driver", async () => {
    const chunk = entities.kb_chunk;
    if (!chunk) throw new Error("Missing chunk fixture");
    const [stored] = await db
      .select()
      .from(schema.kbChunks)
      .where(eq(schema.kbChunks.id, chunk.id));
    expect(stored?.embedding).toEqual(
      Array.from({ length: schema.embeddingDimensions }, (_, index) => (index === 0 ? 1 : 0)),
    );
    expect(stored?.tsv).toContain("rezeptgebuhr");
  });

  test("AC3 German stemming matches Rezeptgebühren to Rezeptgebühr", async () => {
    const chunk = entities.kb_chunk;
    if (!chunk) throw new Error("Missing chunk fixture");
    const chunks = await db
      .select({ text: schema.kbChunks.text })
      .from(schema.kbChunks)
      .where(
        sql`${schema.kbChunks.id} = ${chunk.id} AND ${schema.kbChunks.tsv} @@ plainto_tsquery('german', 'Rezeptgebühren')`,
      );
    expect(chunks).toEqual([{ text: "Information zur Rezeptgebühr." }]);
  });

  test("FR-P5 deleting a source fact deletes its derived facts transitively", async () => {
    const rows = await seedEntities(db);
    const fact = rows.fact;
    const subject = rows.subject;
    if (!fact || !subject) throw new Error("Missing fact fixture");
    const [derived] = await db
      .insert(schema.facts)
      .values({
        subjectId: subject.id,
        type: "derived",
        value: "copied",
        sourceFactId: fact.id,
        source: { kind: "derived" },
        confidence: 1,
      })
      .returning();
    if (!derived) throw new Error("Derived fact was not inserted");
    const [next] = await db
      .insert(schema.facts)
      .values({
        subjectId: subject.id,
        type: "derived",
        value: "copied",
        sourceFactId: derived.id,
        source: { kind: "derived" },
        confidence: 1,
      })
      .returning();
    if (!next) throw new Error("Transitive fact was not inserted");
    await db.delete(schema.facts).where(eq(schema.facts.id, fact.id));
    expect(
      await db.select().from(schema.facts).where(eq(schema.facts.id, derived.id)),
    ).toHaveLength(0);
    expect(await db.select().from(schema.facts).where(eq(schema.facts.id, next.id))).toHaveLength(
      0,
    );
  });

  test("FR-P5 deleting a document deletes facts derived from it", async () => {
    const rows = await seedEntities(db);
    const document = rows.document;
    const fact = rows.fact;
    if (!document || !fact) throw new Error("Missing document fixture");
    await db.delete(schema.documents).where(eq(schema.documents.id, document.id));
    expect(await db.select().from(schema.facts).where(eq(schema.facts.id, fact.id))).toHaveLength(
      0,
    );
  });

  test("FR-P5 deleting a subject cascades to facts, documents and case state", async () => {
    const rows = await seedEntities(db);
    const subject = rows.subject;
    if (!subject) throw new Error("Missing subject fixture");
    await db.delete(schema.subjects).where(eq(schema.subjects.id, subject.id));
    for (const table of ["fact", "document", "case", "form_instance"]) {
      expect(
        await database.sql`SELECT id FROM ${database.sql(table)} WHERE subject_id = ${subject.id}`,
      ).toHaveLength(0);
    }
  });

  test("AC4 installs only vector and pgcrypto beyond built-in plpgsql", async () => {
    const extensions = await database.sql<
      { extname: string }[]
    >`SELECT extname FROM pg_extension ORDER BY extname`;
    expect(extensions.map((extension) => extension.extname)).toEqual([
      "pgcrypto",
      "plpgsql",
      "vector",
    ]);
  });
});
