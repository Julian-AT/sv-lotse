import { randomUUID } from "node:crypto";
import type { CaseHistoryEntry } from "@/features/workspace/case-record.ts";

// Test-only fixture shaped like GET /api/cases/:id/history; persistence is covered against Postgres.
export const historyCaseId = randomUUID();
const actorId = randomUUID();
const at = (second: number): string => new Date(Date.UTC(2026, 10, 6, 9, 0, second)).toISOString();
const message = (role: "user" | "assistant", part: Record<string, unknown>) => ({
  messageId: randomUUID(),
  role,
  position: 0,
  part,
});
const audit = (action: string, second: number) => ({
  id: randomUUID(),
  actorId,
  action,
  target: { caseId: historyCaseId, toolCallId: "prefill-call" },
  approvalId: "approval-1",
  occurredAt: at(second),
});
const approval = {
  id: "approval-row",
  approvalId: "approval-1",
  actorId,
  actor: "you",
  toolCallId: "prefill-call",
  toolName: "form.prefill",
};

export const userText = "Bitte den Antrag vorbereiten";
export const historyEntries: CaseHistoryEntry[] = [
  {
    id: "m1:0",
    at: at(0),
    kind: "text",
    data: message("user", { type: "text", text: userText }),
  },
  {
    id: "m2:0",
    at: at(1),
    kind: "tool-kb.search",
    data: message("assistant", {
      type: "tool-kb.search",
      toolCallId: "search-call",
      state: "output-available",
      input: {},
      output: {},
    }),
  },
  {
    id: "m2:1",
    at: at(2),
    kind: "dynamic-tool",
    data: message("assistant", {
      type: "dynamic-tool",
      toolName: "form.prefill",
      toolCallId: "prefill-call",
      state: "output-available",
      input: {},
      output: {},
      approval: { id: "approval-1", approved: true },
    }),
  },
  {
    id: "approval-row:requested",
    at: at(2),
    kind: "approval.requested",
    data: { ...approval, decision: "pending", requestedAt: at(2) },
  },
  { id: "audit-1", at: at(2), kind: "approval.requested", data: audit("approval.requested", 2) },
  {
    id: "approval-row:decided",
    at: at(3),
    kind: "approval.approved",
    data: { ...approval, decision: "approved", requestedAt: at(2), decidedAt: at(3) },
  },
  { id: "audit-2", at: at(3), kind: "approval.approved", data: audit("approval.approved", 3) },
  {
    id: "turn:action:0",
    at: at(4),
    kind: "action.result",
    data: { actionId: "action-1", resolvedBy: "dom", confidence: 1, success: false },
  },
  {
    id: "m3:0",
    at: at(5),
    kind: "data-case-event",
    data: message("assistant", {
      type: "data-case-event",
      data: { caseId: historyCaseId, kind: "step_completed", payload: {} },
    }),
  },
  { id: "audit-3", at: at(6), kind: "case.updated", data: audit("case.updated", 6) },
];
