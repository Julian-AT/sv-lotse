import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { cases } from "./cases.ts";
import { createdAt, id, type JsonRecord, time } from "./shared.ts";
import { subjects } from "./users.ts";

export const formFormat = pgEnum("form_format", ["acroform", "flat", "scanned", "xfa", "html"]);
export const templateStatus = pgEnum("template_status", ["auto", "verified"]);

export const formFieldValue = z
  .object({
    value: z.json(),
    provenance: z.record(z.string(), z.json()),
    state: z.enum(["draft", "confirmed"]),
    approvalId: z.string().min(1).nullable(),
  })
  .refine((field) => field.state !== "confirmed" || field.approvalId !== null, {
    message: "Confirmed fields require an approval id",
  });
export const formFields = z.record(z.string(), formFieldValue);

export const formTemplates = pgTable(
  "form_template",
  {
    id: id(),
    publisher: text("publisher").notNull(),
    title: text("title").notNull(),
    source: text("source").notNull(),
    hash: text("hash").notNull(),
    versionDate: date("version_date"),
    retrievedAt: time("retrieved_at").defaultNow().notNull(),
    format: formFormat("format").notNull(),
    pages: integer("pages").notNull(),
    status: templateStatus("status").default("auto").notNull(),
    schema: jsonb("schema").$type<JsonRecord>().notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("form_template_source_hash_unique").on(table.source, table.hash),
    check("form_template_pages_check", sql`${table.pages} > 0`),
  ],
);

export const formInstances = pgTable(
  "form_instance",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => formTemplates.id, { onDelete: "restrict" }),
    fields: jsonb("fields").$type<z.infer<typeof formFields>>().notNull(),
    outputKey: text("output_key"),
    createdAt: createdAt(),
  },
  (table) => [index("form_instance_case_idx").on(table.caseId)],
);
