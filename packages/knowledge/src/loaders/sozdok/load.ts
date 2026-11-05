import { createHash } from "node:crypto";
import type { Database } from "@lotse/brain/db";
import { embeddingDimensions } from "@lotse/brain/db/schema";
import { z } from "zod";
import { chunkSozdok, type SozdokChunk, sozdokCitation, sozdokMetadata } from "./chunk.ts";
import { readSozdok, sozdokDate } from "./parse.ts";
import { groupVersions, inForceOn, provisionKey, type SozdokVersion } from "./versions.ts";

const optionsSchema = z.object({
  directory: z.string().min(1).optional(),
  on: sozdokDate.optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type SozdokOptions = z.input<typeof optionsSchema>;
export interface SozdokLoadOptions extends SozdokOptions {
  embed?: (chunk: SozdokChunk) => Promise<number[]>;
}

async function selectedVersions(options: SozdokOptions): Promise<SozdokVersion[]> {
  const config = optionsSchema.parse(options);
  const groups = groupVersions(await readSozdok(config.directory));
  return [...groups.values()].flatMap((versions) => {
    if (!config.on) return versions;
    const version = inForceOn(versions, config.on);
    return version ? [version] : [];
  });
}

/** Embedding-free input for WP-103's indexer, with validity computed over the full history. */
export async function sozdokChunks(options: SozdokOptions = {}): Promise<SozdokChunk[]> {
  const config = optionsSchema.parse(options);
  return (await selectedVersions(config)).flatMap((record) =>
    chunkSozdok(record, config.maxTokens),
  );
}

// The schema has no URL uniqueness constraint. Stable, namespaced UUIDs make concurrent
// reruns conflict on the existing primary key without requiring a schema change.
function stableId(key: string): string {
  const hex = createHash("sha256").update(`lotse:sozdok:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const embeddingSchema = z
  .array(z.number().finite())
  .length(embeddingDimensions)
  .refine((vector) => vector.some((value) => value !== 0), "Embedding must be nonzero");

const storedVersionSchema = z.object({
  dokid: z.string().min(1),
  law_abbr: z.string().min(1),
  gldart: z.string().min(1),
  paragraph: z.object({ gldnr: z.string(), gldsym: z.string().nullable() }),
  file: z.string().min(1),
  in_force_from: sozdokDate,
  in_force_to: sozdokDate.nullable(),
});

function earliestEnd(...ends: (string | null | undefined)[]): string | null {
  return ends.filter((end): end is string => end != null).sort()[0] ?? null;
}

export async function loadSozdok(
  database: Database,
  options: SozdokLoadOptions = {},
): Promise<{ sources: number; chunks: number }> {
  const config = optionsSchema.parse(options);
  const history = [...groupVersions(await readSozdok(config.directory)).values()].flat();
  return database.sql.begin(async (sql) => {
    // One namespaced lock serializes reconciliation without consuming a lock per file.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('lotse:sozdok:load', 0))`;
    const rows = await sql<{ id: string; metadata: unknown }[]>`
      SELECT id, metadata FROM source
      WHERE starts_with(url, 'sozdok://') AND metadata->>'kind' = 'legal'`;
    const persisted = rows.map((row) => ({
      id: row.id,
      record: storedVersionSchema.parse(row.metadata),
    }));
    const incoming = new Map(history.map((record) => [record.dokid, record]));
    const existing = new Map(persisted.map(({ record }) => [record.dokid, record]));
    const affected = new Set(history.map(provisionKey));
    // A metadata correction may move a document to another provision identity.
    for (const { record } of persisted) {
      if (incoming.has(record.dokid)) affected.add(provisionKey(record));
    }
    const combined = new Map(existing);
    for (const record of history) combined.set(record.dokid, record);
    const ends = new Map<string, string | null>();
    for (const versions of groupVersions(
      [...combined.values()].filter((record) => affected.has(provisionKey(record))),
    ).values()) {
      for (const record of versions) {
        // A partial directory cannot disprove an already known successor, even if
        // that successor was only seen by an earlier date-filtered load.
        ends.set(
          record.dokid,
          earliestEnd(
            record.in_force_to,
            incoming.get(record.dokid)?.in_force_to,
            existing.get(record.dokid)?.in_force_to,
          ),
        );
      }
    }
    const resolved = history.map((record) => ({
      ...record,
      in_force_to: ends.get(record.dokid) ?? null,
    }));
    const on = config.on;
    const records = on ? resolved.filter((record) => inForceOn([record], on)) : resolved;
    // Validate every supplied embedding using reconciled metadata before writes.
    const prepared: {
      record: SozdokVersion;
      chunks: { chunk: SozdokChunk; embedding: number[] }[];
    }[] = [];
    for (const record of records) {
      const chunks = [];
      if (options.embed) {
        for (const chunk of chunkSozdok(record, config.maxTokens)) {
          chunks.push({ chunk, embedding: embeddingSchema.parse(await options.embed(chunk)) });
        }
      }
      prepared.push({ record, chunks });
    }
    // Reconcile stored members of affected provisions, including predecessors absent
    // from this directory and input versions excluded by --on, in the same transaction.
    for (const { id, record: stored } of persisted) {
      if (!ends.has(stored.dokid)) continue;
      const record = incoming.get(stored.dokid) ?? stored;
      const end = ends.get(stored.dokid) ?? null;
      if (stored.in_force_from === record.in_force_from && stored.in_force_to === end) continue;
      const validFrom = `${record.in_force_from}T00:00:00.000Z`;
      const validTo = end ? `${end}T00:00:00.000Z` : null;
      await sql`DELETE FROM kb_chunk WHERE source_id = ${id} AND EXISTS (
        SELECT 1 FROM source WHERE id = ${id} AND
        (valid_from IS DISTINCT FROM ${validFrom}::timestamptz
          OR valid_to IS DISTINCT FROM ${validTo}::timestamptz))`;
      await sql`UPDATE source SET valid_from = ${validFrom}, valid_to = ${validTo},
        metadata = metadata || ${JSON.stringify({ in_force_from: record.in_force_from, in_force_to: end })}::jsonb
        WHERE id = ${id}`;
    }
    for (const { record, chunks } of prepared) {
      const url = `sozdok://${record.dokid}`;
      const id = stableId(url);
      const validFrom = `${record.in_force_from}T00:00:00.000Z`;
      const validTo = record.in_force_to ? `${record.in_force_to}T00:00:00.000Z` : null;
      const metadata = {
        ...sozdokMetadata(record),
        citation: sozdokCitation(record),
        law_title: record.law_title,
        doc_type: record.doc_type,
        heading: record.heading,
        published_at: record.published_at,
        decided_at: record.decided_at,
        publication_refs: record.publication_refs,
        visibility: record.visibility,
        as_of: record.published_at ?? record.in_force_from,
        content_hash: createHash("sha256").update(record.text).digest("hex"),
      };
      // Changed sources must not retain stale embeddings from an earlier indexing run.
      await sql`DELETE FROM kb_chunk WHERE source_id = ${id} AND EXISTS (
        SELECT 1 FROM source WHERE id = ${id} AND
        (text IS DISTINCT FROM ${record.text} OR valid_from IS DISTINCT FROM ${validFrom}::timestamptz
          OR valid_to IS DISTINCT FROM ${validTo}::timestamptz
          OR NOT (metadata @> ${JSON.stringify({ ...sozdokMetadata(record), citation: sozdokCitation(record) })}::jsonb)))`;
      // The shared Drizzle client disables Postgres.js JSON serializers.
      await sql`INSERT INTO source (id, url, title, publisher, text, metadata, valid_from, valid_to)
        VALUES (${id}, ${url}, ${sozdokCitation(record)}, ${record.publisher ?? "SozDok"},
          ${record.text}, ${JSON.stringify(metadata)}::jsonb, ${validFrom}, ${validTo})
        ON CONFLICT (id) DO UPDATE SET url = excluded.url, title = excluded.title,
          publisher = excluded.publisher, text = excluded.text, metadata = excluded.metadata,
          valid_from = excluded.valid_from, valid_to = excluded.valid_to`;
      if (options.embed) {
        await sql`DELETE FROM kb_chunk WHERE source_id = ${id}`;
        for (const { chunk, embedding } of chunks) {
          await sql`INSERT INTO kb_chunk (id, source_id, text, embedding, metadata, valid_from, valid_to)
            VALUES (${stableId(`${url}:chunk:${chunk.index}`)}, ${id}, ${chunk.text},
              ${`[${embedding.join(",")}]`}::vector, ${JSON.stringify({ ...chunk.metadata, citation: chunk.citation, index: chunk.index })}::jsonb, ${validFrom}, ${validTo})`;
        }
      }
    }
    return {
      sources: records.length,
      chunks: prepared.reduce((count, item) => count + item.chunks.length, 0),
    };
  });
}
