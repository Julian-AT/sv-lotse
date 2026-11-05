import { sql } from "drizzle-orm";
import { check, customType, index, jsonb, pgTable, text, uuid, vector } from "drizzle-orm/pg-core";
import { createdAt, id, type JsonRecord, time } from "./shared.ts";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
export const embeddingDimensions = 1536;

export const sources = pgTable(
  "source",
  {
    id: id(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    publisher: text("publisher").notNull(),
    text: text("text"),
    metadata: jsonb("metadata").$type<JsonRecord>().default({}).notNull(),
    validFrom: time("valid_from"),
    validTo: time("valid_to"),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "source_validity_check",
      sql`${table.validFrom} IS NULL OR ${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const kbChunks = pgTable(
  "kb_chunk",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: embeddingDimensions }).notNull(),
    metadata: jsonb("metadata").$type<JsonRecord>().default({}).notNull(),
    validFrom: time("valid_from"),
    validTo: time("valid_to"),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('german'::regconfig, "text")`).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("kb_chunk_source_idx").on(table.sourceId),
    index("kb_chunk_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    index("kb_chunk_tsv_gin_idx").using("gin", table.tsv),
    check(
      "kb_chunk_validity_check",
      sql`${table.validFrom} IS NULL OR ${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);
