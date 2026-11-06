import type { DatabaseClient } from "@lotse/db";
import { approvals, messages } from "@lotse/db/schema";
import { DATA_PARTS } from "@lotse/protocol";
import { getToolName, isToolUIPart, validateUIMessages } from "ai";
import { and, eq } from "drizzle-orm";
import type { RuntimeContext } from "../agent/context.ts";
import { allowedToolNames } from "../agent/permissions.ts";
import { canonicalJson } from "../approvals/canonical.ts";
import type { createApprovalService, Transaction } from "../approvals/index.ts";
import { contracts, isToolName } from "../tools/contracts/index.ts";
import type { LotseMessage } from "../tools/types.ts";
import { rejectContinuation, TurnError } from "./errors.ts";

const OPEN_TOOL_STATES: readonly string[] = [
  "approval-requested",
  "approval-responded",
  "input-available",
];

/**
 * A new user message supersedes client-side calls that are still waiting for the app (a page read,
 * a pointer). They end as interrupted; calls awaiting or holding an approval stay untouched.
 */
export function interruptPendingClientCalls(message: LotseMessage): LotseMessage {
  return {
    ...message,
    parts: message.parts.map((part) =>
      isToolUIPart(part) && part.state === "input-available" && !part.approval
        ? { ...part, state: "output-error" as const, errorText: "TOOL_INTERRUPTED" }
        : part,
    ),
  };
}

export function hasOpenToolCall(message: LotseMessage | undefined): boolean {
  return (
    message?.parts.some((part) => isToolUIPart(part) && OPEN_TOOL_STATES.includes(part.state)) ??
    false
  );
}

export async function validateLatest(raw: unknown): Promise<LotseMessage> {
  try {
    const [message] = await validateUIMessages<LotseMessage>({
      messages: [raw],
      dataSchemas: DATA_PARTS,
    });
    if (!message || message.role === "system") throw new Error("Invalid role");
    if (
      message.role === "user" &&
      (!message.parts.length || message.parts.some((part) => part.type !== "text"))
    )
      throw new Error("Invalid user part");
    return message;
  } catch {
    throw new TurnError("INVALID_TURN", 400);
  }
}

// Only decisions and outputs for already persisted calls may change. Every
// other byte of an assistant continuation remains owned by the server.
export async function mergeLatest(
  tx: Transaction,
  history: LotseMessage[],
  latest: LotseMessage,
  context: RuntimeContext,
  approvalService: ReturnType<typeof createApprovalService>,
) {
  if (latest.role === "user") {
    if (history.some((message) => message.id === latest.id)) rejectContinuation();
    const last = history.at(-1);
    if (last?.role === "assistant" && hasOpenToolCall(last)) {
      const settled = interruptPendingClientCalls(last);
      if (hasOpenToolCall(settled)) rejectContinuation();
      return { history: [...history.slice(0, -1), settled, latest], dispatch: [] as string[] };
    }
    return { history: [...history, latest], dispatch: [] as string[] };
  }
  const stored = history.at(-1);
  if (
    stored?.role !== "assistant" ||
    stored.id !== latest.id ||
    stored.parts.length !== latest.parts.length ||
    canonicalJson(stored.metadata ?? null) !== canonicalJson(latest.metadata ?? null)
  )
    rejectContinuation();
  const updated = structuredClone(stored);
  const dispatch: string[] = [];
  let changed = false;
  for (const [index, before] of stored.parts.entries()) {
    const after = latest.parts[index];
    if (!after) rejectContinuation();
    if (canonicalJson(before) === canonicalJson(after)) continue;
    if (!isToolUIPart(before) || !isToolUIPart(after)) rejectContinuation();
    const name = getToolName(before);
    if (
      !isToolName(name) ||
      getToolName(after) !== name ||
      before.toolCallId !== after.toolCallId ||
      canonicalJson(before.input) !== canonicalJson(after.input)
    )
      rejectContinuation();
    // Fields not owned by an approval decision or tool output are immutable.
    const {
      state: _beforeState,
      output: _beforeOutput,
      errorText: _beforeError,
      approval: _beforeApproval,
      ...beforeFixed
    } = before;
    const {
      state: _afterState,
      output: _afterOutput,
      errorText: _afterError,
      approval: _afterApproval,
      ...afterFixed
    } = after;
    if (canonicalJson(beforeFixed) !== canonicalJson(afterFixed)) rejectContinuation();
    if (before.state === "approval-requested" && after.state === "approval-responded") {
      const { approved, reason, ...returned } = after.approval;
      if (approved && !allowedToolNames(context.autonomyLevel, context.actorRole).includes(name))
        rejectContinuation();
      if (!before.approval.signature || canonicalJson(returned) !== canonicalJson(before.approval))
        rejectContinuation();
      await approvalService.decide(
        tx,
        {
          approvalId: before.approval.id,
          toolCallId: before.toolCallId,
          toolName: name,
          input: before.input,
        },
        context,
        approved,
      );
      updated.parts[index] = {
        ...before,
        state: "approval-responded",
        approval: { ...before.approval, approved, ...(reason === undefined ? {} : { reason }) },
      };
      if (approved && contracts[name].location === "client") dispatch.push(before.toolCallId);
      changed = true;
    } else if (
      (before.state === "input-available" ||
        (before.state === "approval-responded" && before.approval.approved)) &&
      (after.state === "output-available" || after.state === "output-error") &&
      contracts[name].location === "client"
    ) {
      // A downgrade must not strand the conversation after a client action was
      // already dispatched. This only records its receipt, never redispatches it.
      if (
        context.actorRole !== "subject" &&
        !allowedToolNames(context.autonomyLevel, context.actorRole).includes(name)
      )
        rejectContinuation();
      if (canonicalJson(before.approval ?? null) !== canonicalJson(after.approval ?? null))
        rejectContinuation();
      if (contracts[name].approval) {
        if (!before.approval) rejectContinuation();
        const [row] = await tx
          .select()
          .from(approvals)
          .where(
            and(
              eq(approvals.approvalId, before.approval.id),
              eq(approvals.sessionId, context.sessionId),
              eq(approvals.actorId, context.actorId),
              eq(approvals.decision, "approved"),
            ),
          );
        if (!row?.consumedAt) rejectContinuation();
      }
      const parsedOutput =
        after.state === "output-available"
          ? contracts[name].output.safeParse(after.output)
          : undefined;
      if (parsedOutput && !parsedOutput.success) rejectContinuation();
      updated.parts[index] =
        after.state === "output-available"
          ? {
              ...beforeFixed,
              input: before.input,
              state: "output-available",
              output: parsedOutput?.data,
              ...(before.approval
                ? { approval: { ...before.approval, approved: true as const } }
                : {}),
            }
          : {
              ...beforeFixed,
              input: before.input,
              state: "output-error",
              errorText: "CLIENT_TOOL_FAILED",
              ...(before.approval
                ? { approval: { ...before.approval, approved: true as const } }
                : {}),
            };
      changed = true;
    } else rejectContinuation();
  }
  if (!changed) rejectContinuation();
  return { history: [...history.slice(0, -1), updated], dispatch };
}

export async function saveMessages(tx: Transaction, caseId: string, history: LotseMessage[]) {
  for (const [position, message] of history.entries()) {
    await tx
      .insert(messages)
      .values({ caseId, position, uiMessage: message })
      .onConflictDoUpdate({
        target: [messages.caseId, messages.position],
        set: { uiMessage: message },
      });
  }
}

export async function loadMessages(
  db: DatabaseClient | Transaction,
  caseId: string,
): Promise<LotseMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.caseId, caseId))
    .orderBy(messages.position);
  return rows.map((row) => row.uiMessage as LotseMessage);
}
