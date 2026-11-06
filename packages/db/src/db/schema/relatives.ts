import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { helperInvites } from "./invites.ts";
import { createdAt, id, time } from "./shared.ts";
import { sessions } from "./users.ts";

export const relativeSessions = pgTable(
  "relative_session",
  {
    id: id(),
    inviteId: uuid("invite_id")
      .notNull()
      .unique()
      .references(() => helperInvites.id, { onDelete: "cascade" }),
    ownerSessionId: uuid("owner_session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    helperSessionId: uuid("helper_session_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),
    state: text("state", { enum: ["invited", "pending", "approved", "ended"] })
      .default("invited")
      .notNull(),
    expiresAt: time("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "relative_session_state_check",
      sql`${table.state} IN ('invited', 'pending', 'approved', 'ended')`,
    ),
    check(
      "relative_session_helper_check",
      sql`${table.state} NOT IN ('pending', 'approved') OR ${table.helperSessionId} IS NOT NULL`,
    ),
    check("relative_session_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
