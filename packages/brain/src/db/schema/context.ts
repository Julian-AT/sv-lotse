import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { turns } from "./cases.ts";
import { createdAt, id, type JsonRecord, type JsonValue } from "./shared.ts";
import { clientKind, subjects } from "./users.ts";

export const ocrStatus = pgEnum("ocr_status", ["pending", "processing", "completed", "failed"]);

export const documents = pgTable(
  "document",
  {
    id: id(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    storageKey: text("storage_key").notNull(),
    hash: text("hash").notNull(),
    pages: jsonb("pages").$type<JsonValue[]>().default([]).notNull(),
    ocrStatus: ocrStatus("ocr_status").default("pending").notNull(),
    originClient: clientKind("origin_client").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("document_subject_idx").on(table.subjectId)],
);

export const facts = pgTable(
  "fact",
  {
    id: id(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    value: jsonb("value").$type<JsonValue>().notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id").references(() => turns.id, { onDelete: "cascade" }),
    sourceFactId: uuid("source_fact_id").references((): AnyPgColumn => facts.id, {
      onDelete: "cascade",
    }),
    source: jsonb("source").$type<JsonRecord>().notNull(),
    confidence: doublePrecision("confidence").notNull(),
    confirmed: boolean("confirmed").default(false).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("fact_subject_type_idx").on(table.subjectId, table.type),
    index("fact_document_idx").on(table.documentId),
    index("fact_turn_idx").on(table.turnId),
    index("fact_source_fact_idx").on(table.sourceFactId),
    check("fact_confidence_check", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check(
      "fact_source_check",
      sql`num_nonnulls(${table.documentId}, ${table.turnId}, ${table.sourceFactId}) = 1`,
    ),
    check("fact_not_own_source_check", sql`${table.sourceFactId} <> ${table.id}`),
  ],
);
