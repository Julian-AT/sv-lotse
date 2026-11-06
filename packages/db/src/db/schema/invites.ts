import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { cases } from "./cases.ts";
import { createdAt, id, type JsonRecord, time } from "./shared.ts";
import { users } from "./users.ts";

export const helperInvites = pgTable(
  "helper_invite",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique("helper_invite_token_hash_unique"),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    issuerId: uuid("issuer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shareScope: jsonb("share_scope").$type<JsonRecord>().notNull(),
    expiresAt: time("expires_at").notNull(),
    consumedAt: time("consumed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("helper_invite_case_idx").on(table.caseId),
    index("helper_invite_issuer_idx").on(table.issuerId),
    check("helper_invite_token_hash_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("helper_invite_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "helper_invite_consumption_check",
      sql`${table.consumedAt} IS NULL OR ${table.consumedAt} >= ${table.createdAt}`,
    ),
  ],
);
