import type { UIMessage } from "ai";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, type JsonRecord, type JsonValue, time } from "./shared.ts";
import { caseActors, sessions, subjects } from "./users.ts";

export const caseStatus = pgEnum("case_status", ["active", "paused", "completed", "archived"]);
export const stepStatus = pgEnum("step_status", ["pending", "in_progress", "blocked", "completed"]);
export const stepOwner = pgEnum("step_owner", ["user", "pilot", "office"]);
export const approvalDecision = pgEnum("approval_decision", ["pending", "approved", "denied"]);
export const turnStatus = pgEnum("turn_status", [
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "interrupted",
]);

export const cases = pgTable(
  "case",
  {
    id: id(),
    subjectId: uuid("subject_id")
      .notNull()
      .references((): AnyPgColumn => subjects.id, { onDelete: "cascade" }),
    confirmedGoal: text("confirmed_goal").notNull(),
    lifeSituation: text("life_situation"),
    status: caseStatus("status").default("active").notNull(),
    journeyMap: jsonb("journey_map").$type<JsonValue>().default([]).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("case_subject_idx").on(table.subjectId)],
);

export const caseSteps = pgTable(
  "case_step",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    processStep: text("process_step").notNull(),
    status: stepStatus("status").default("pending").notNull(),
    owner: stepOwner("owner").notNull(),
    dueAt: time("due_at"),
    linkedArtifacts: jsonb("linked_artifacts").$type<JsonValue[]>().default([]).notNull(),
    initiatedBy: stepOwner("initiated_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("case_step_case_idx").on(table.caseId)],
);

export const approvals = pgTable(
  "approval",
  {
    id: id(),
    approvalId: text("approval_id").notNull().unique("approval_approval_id_unique"),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    inputHash: text("input_hash").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references((): AnyPgColumn => caseActors.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references((): AnyPgColumn => sessions.id, { onDelete: "cascade" }),
    decision: approvalDecision("decision").default("pending").notNull(),
    requestedAt: time("requested_at").defaultNow().notNull(),
    decidedAt: time("decided_at"),
    consumedAt: time("consumed_at"),
    hmac: text("hmac").notNull(),
  },
  (table) => [
    index("approval_case_idx").on(table.caseId),
    check("approval_input_hash_check", sql`${table.inputHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "approval_decision_time_check",
      sql`(${table.decision} = 'pending' AND ${table.decidedAt} IS NULL) OR (${table.decision} <> 'pending' AND ${table.decidedAt} IS NOT NULL AND ${table.decidedAt} >= ${table.requestedAt})`,
    ),
    check(
      "approval_consumption_check",
      sql`${table.consumedAt} IS NULL OR (${table.decision} = 'approved' AND ${table.decidedAt} IS NOT NULL AND ${table.consumedAt} >= ${table.decidedAt})`,
    ),
  ],
);

export const messages = pgTable(
  "message",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    uiMessage: jsonb("ui_message").$type<UIMessage>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("message_case_position_unique").on(table.caseId, table.position),
    check("message_position_check", sql`${table.position} >= 0`),
  ],
);

export const turns = pgTable(
  "turn",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    messageIds: uuid("message_ids").array().default([]).notNull(),
    capsuleDigest: text("capsule_digest"),
    segments: jsonb("segments").$type<JsonValue[]>().default([]).notNull(),
    toolCalls: jsonb("tool_calls").$type<JsonValue[]>().default([]).notNull(),
    actionResults: jsonb("action_results").$type<JsonValue[]>().default([]).notNull(),
    modelIds: jsonb("model_ids").$type<JsonRecord>().default({}).notNull(),
    timings: jsonb("timings").$type<JsonRecord>().default({}).notNull(),
    status: turnStatus("status").default("running").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("turn_case_idx").on(table.caseId)],
);
