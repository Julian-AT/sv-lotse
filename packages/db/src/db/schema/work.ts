import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { cases } from "./cases.ts";
import { createdAt, id, type JsonRecord, time } from "./shared.ts";
import { users } from "./users.ts";

export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const reminders = pgTable(
  "reminder",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    dueAt: time("due_at").notNull(),
    source: jsonb("source").$type<JsonRecord>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("reminder_case_idx").on(table.caseId)],
);

export const jobs = pgTable(
  "job",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    stepState: jsonb("step_state").$type<JsonRecord>().default({}).notNull(),
    status: jobStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("job_case_idx").on(table.caseId),
    check("job_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const helperSessions = pgTable(
  "helper_session",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    helperId: uuid("helper_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: jsonb("scope").$type<JsonRecord>().notNull(),
    startedAt: time("started_at").defaultNow().notNull(),
    endedAt: time("ended_at"),
  },
  (table) => [
    index("helper_session_case_idx").on(table.caseId),
    check(
      "helper_session_end_check",
      sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

// Opaque identifiers intentionally have no FK: audit rows must survive cascades unchanged.
// Never put user content, documents or field values in action or target.
export const auditEvents = pgTable("audit_event", {
  id: id(),
  actorId: uuid("actor_id").notNull(),
  action: text("action").notNull(),
  target: jsonb("target").$type<JsonRecord>().notNull(),
  approvalId: text("approval_id"),
  occurredAt: time("occurred_at").defaultNow().notNull(),
});
