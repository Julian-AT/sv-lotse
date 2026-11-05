import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { cases } from "./cases.ts";
import { createdAt, id, type JsonRecord, time } from "./shared.ts";

export const userKind = pgEnum("user_kind", ["anonymous"]);
export const clientKind = pgEnum("client_kind", ["web", "mac", "helper"]);
export const actorRole = pgEnum("actor_role", ["subject", "helper"]);
export const autonomyLevel = pgEnum("autonomy_level", ["L1", "L2", "L3"]);
export const languageRegister = pgEnum("language_register", ["formal", "informal"]);
export const detailLevel = pgEnum("detail_level", ["brief", "standard", "detailed"]);

export const users = pgTable("user", {
  id: id(),
  kind: userKind("kind").default("anonymous").notNull(),
  createdAt: createdAt(),
  lastSeenAt: time("last_seen_at").defaultNow().notNull(),
});

export const sessions = pgTable(
  "session",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientKind: clientKind("client_kind").notNull(),
    createdAt: createdAt(),
    expiresAt: time("expires_at").notNull(),
  },
  (table) => [
    index("session_user_idx").on(table.userId),
    check("session_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const subjects = pgTable(
  "subject",
  {
    id: id(),
    displayName: text("display_name").notNull(),
    relationToUser: text("relation_to_user").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [index("subject_created_by_idx").on(table.createdBy)],
);

export const caseActors = pgTable(
  "case_actor",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references((): AnyPgColumn => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: actorRole("role").notNull(),
    shareScope: jsonb("share_scope").$type<JsonRecord>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [unique("case_actor_case_user_unique").on(table.caseId, table.userId)],
);

export const profiles = pgTable("profile", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  language: text("language").default("de-AT").notNull(),
  register: languageRegister("register").default("formal").notNull(),
  detailLevel: detailLevel("detail_level").default("standard").notNull(),
  autonomyLevel: autonomyLevel("autonomy_level").default("L1").notNull(),
  carrier: text("carrier"),
  region: text("region"),
  ageBand: text("age_band"),
  createdAt: createdAt(),
});
