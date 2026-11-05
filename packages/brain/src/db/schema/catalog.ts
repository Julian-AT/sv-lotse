import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, type JsonRecord } from "./shared.ts";

export const benefits = pgTable("benefit", {
  id: id(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  carrier: text("carrier"),
  region: text("region"),
  record: jsonb("record").$type<JsonRecord>().notNull(),
  createdAt: createdAt(),
});

export const offices = pgTable("office", {
  id: id(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  carrier: text("carrier"),
  region: text("region"),
  record: jsonb("record").$type<JsonRecord>().notNull(),
  createdAt: createdAt(),
});

export const facilities = pgTable("facility", {
  id: id(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  region: text("region"),
  record: jsonb("record").$type<JsonRecord>().notNull(),
  createdAt: createdAt(),
});

export const processes = pgTable("process", {
  id: id(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  benefitId: uuid("benefit_id").references(() => benefits.id, { onDelete: "restrict" }),
  record: jsonb("record").$type<JsonRecord>().notNull(),
  createdAt: createdAt(),
});
