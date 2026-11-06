import { randomUUID } from "node:crypto";
import { createDatabase, type DatabaseClient } from "@lotse/db";
import { messages, turns } from "@lotse/db/schema";
import { DATA_PARTS, type TurnRequest, TurnRequestSchema } from "@lotse/protocol";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  type LanguageModel,
  type UIMessageChunk,
  validateUIMessages,
} from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createLotseAgent } from "../agent/index.ts";
import { canonicalJson } from "../approvals/canonical.ts";
import { createApprovalService } from "../approvals/index.ts";
import { type BrainConfig, parseBrainConfig } from "../config/index.ts";
import { contracts, isToolName } from "../tools/contracts/index.ts";
import { ToolNotImplementedError } from "../tools/stubs.ts";
import type { LotseMessage } from "../tools/types.ts";
import { approvedResultCheckpoint } from "./approved-results.ts";
import { TurnError } from "./errors.ts";
import { loadMessages, mergeLatest, saveMessages, validateLatest } from "./history.ts";
import { recoverConsumedCalls } from "./recovery.ts";
import { claimTurn, lockTurnClaim, resolveContext, type SessionIdentity } from "./store.ts";

const bodySchema = TurnRequestSchema.extend({
  message: z.unknown().optional(),
  messages: z.array(z.unknown()).optional(),
});
export function parseTurnBody(raw: unknown) {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new TurnError("INVALID_TURN", 400);
  const { message, messages: clientMessages, ...turn } = parsed.data;
  return { turn, latestMessage: message ?? clientMessages?.at(-1) };
}
let defaultDatabase: ReturnType<typeof createDatabase> | undefined;
let defaultConfig: BrainConfig | undefined;
export async function closeBrain() {
  await defaultDatabase?.close();
  defaultDatabase = undefined;
  defaultConfig = undefined;
}
function defaults() {
  defaultConfig ??= parseBrainConfig();
  defaultDatabase ??= createDatabase();
  return { db: defaultDatabase.db, config: defaultConfig };
}

function checkpoints() {
  let completed = 0;
  let failure: unknown;
  const waits = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>();
  return {
    wait: (step: number) => {
      if (failure) return Promise.reject(failure);
      if (step <= completed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waits.set(step, { resolve, reject });
      });
    },
    complete: () => {
      completed++;
      waits.get(completed)?.resolve();
      waits.delete(completed);
    },
    fail: (error: unknown) => {
      failure = error;
      for (const wait of waits.values()) wait.reject(error);
      waits.clear();
    },
  };
}

export async function handleTurn(
  request: TurnRequest,
  latestMessage: unknown,
  session: SessionIdentity,
  options?: {
    db?: DatabaseClient;
    config?: BrainConfig;
    model?: LanguageModel;
    abortSignal?: AbortSignal;
  },
): Promise<Response> {
  const runtime =
    options?.db && options.config ? { db: options.db, config: options.config } : defaults();
  const db = options?.db ?? runtime.db;
  const config = options?.config ?? runtime.config;
  const parsed = TurnRequestSchema.parse(request);
  const latest = await validateLatest(latestMessage);
  const approvalService = createApprovalService(db, config.approvalSecret);
  const prepared = await db.transaction(async (tx) => {
    const context = await resolveContext(tx, parsed, session);
    // History can repeat private facts in prose as well as tool results. Until
    // it has a provenance-aware projection, restricted helpers cannot read it.
    if (context.actorRole === "helper" && context.shareScope.facts !== true)
      throw new TurnError("CASE_ACCESS_DENIED", 403);
    const { turnId, recover } = await claimTurn(tx, context, parsed);
    const stored = await loadMessages(tx, context.caseId);
    const history = recover ? await recoverConsumedCalls(tx, context.caseId, stored) : stored;
    const merged = await mergeLatest(tx, history, latest, context, approvalService);
    await saveMessages(tx, context.caseId, merged.history);
    return { ...merged, context, turnId };
  });
  const checkpoint = checkpoints();
  const cancellation = new AbortController();
  let failed = false;
  const save = async (
    history: LotseMessage[],
    status?: "completed" | "awaiting_approval" | "failed" | "interrupted",
  ) => {
    try {
      const normalized = await validateUIMessages<LotseMessage>({
        messages: prepared.dispatch.length > 0 ? prepared.history : history,
        dataSchemas: DATA_PARTS,
      });
      await db.transaction(async (tx) => {
        await lockTurnClaim(tx, prepared.context.caseId, prepared.turnId);
        await saveMessages(tx, prepared.context.caseId, normalized);
        const rows = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.caseId, prepared.context.caseId))
          .orderBy(messages.position);
        await tx
          .update(turns)
          .set({ messageIds: rows.map((row) => row.id), ...(status ? { status } : {}) })
          .where(eq(turns.id, prepared.turnId));
      });
    } catch (error) {
      checkpoint.fail(error);
      throw error;
    }
  };
  const stream = createUIMessageStream<LotseMessage>({
    originalMessages: prepared.history,
    generateId: randomUUID,
    onError: (error) => {
      failed = true;
      checkpoint.fail(error);
      return error instanceof ToolNotImplementedError ? error.code : "TURN_FAILED";
    },
    onStepEnd: async ({ messages: history }) => {
      await save(history);
      checkpoint.complete();
    },
    onEnd: async ({ messages: history, isAborted, isCancelled }) => {
      if (isAborted || isCancelled) cancellation.abort();
      try {
        const awaiting = history
          .at(-1)
          ?.parts.some(
            (part) =>
              isToolUIPart(part) &&
              ["approval-requested", "approval-responded", "input-available"].includes(part.state),
          );
        await save(
          history,
          failed
            ? "failed"
            : isAborted || isCancelled
              ? "interrupted"
              : awaiting
                ? "awaiting_approval"
                : "completed",
        );
      } finally {
        checkpoint.fail(new Error("Turn stream ended"));
      }
    },
    execute: async ({ writer }) => {
      // SDK client tools deliberately have no execute. After the authoritative
      // transaction consumes approval, re-emit just those calls to onToolCall.
      // Wait for addToolOutput before asking the model for the next step.
      if (prepared.dispatch.length > 0) {
        writer.write({ type: "start" });
        const last = prepared.history.at(-1);
        for (const part of last?.parts ?? []) {
          if (isToolUIPart(part) && prepared.dispatch.includes(part.toolCallId)) {
            writer.write({
              type: "tool-input-available",
              toolCallId: part.toolCallId,
              toolName: getToolName(part),
              input: part.input,
            });
          }
        }
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish" });
        return;
      }
      const agent = createLotseAgent({
        context: prepared.context,
        config,
        dependencies: { db, allowStubs: config.allowStubs, writer },
        ...(options?.model ? { model: options.model } : {}),
        checkpoint: checkpoint.wait,
        persistToolResult: approvedResultCheckpoint(prepared.history, save),
      });
      const result = await agent.stream({
        messages: await convertToModelMessages(prepared.history),
        timeout: { totalMs: 240_000, stepMs: 60_000 },
        abortSignal: options?.abortSignal
          ? AbortSignal.any([options.abortSignal, cancellation.signal])
          : cancellation.signal,
      });
      const inputs = new Map<string, { toolName: string; input: unknown }>();
      const withheldInputs = new Set<string>();
      const sdkStream = result.toUIMessageStream<LotseMessage>({
        originalMessages: prepared.history,
        onError: (error) => (error instanceof ToolNotImplementedError ? error.code : "TURN_FAILED"),
      });
      const reader = sdkStream.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          const part: UIMessageChunk = next.value;
          if (
            part.type === "tool-input-start" &&
            isToolName(part.toolName) &&
            contracts[part.toolName].location === "client" &&
            contracts[part.toolName].approval
          ) {
            withheldInputs.add(part.toolCallId);
            continue;
          }
          if (part.type === "tool-input-delta" && withheldInputs.has(part.toolCallId)) continue;
          if (part.type === "tool-input-available") {
            inputs.set(part.toolCallId, { toolName: part.toolName, input: part.input });
            if (
              isToolName(part.toolName) &&
              contracts[part.toolName].location === "client" &&
              contracts[part.toolName].approval
            ) {
              // onToolCall fires on input-available, before SDK approval parts.
              // Populate its UI preview using input-start/delta instead. Dispatch
              // input-available only on the separately verified continuation.
              writer.write({
                type: "tool-input-start",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              });
              writer.write({
                type: "tool-input-delta",
                toolCallId: part.toolCallId,
                inputTextDelta: canonicalJson(part.input),
              });
              continue;
            }
          }
          if (part.type === "tool-approval-request") {
            const call = inputs.get(part.toolCallId);
            if (!call) throw new Error("Approval without tool input");
            const context = await approvalService.request(
              { ...call, approvalId: part.approvalId, toolCallId: part.toolCallId },
              prepared.context,
            );
            writer.write(part);
            writer.write({ type: "data-approval-context", data: context });
          } else {
            if (part.type === "error") {
              failed = true;
              checkpoint.fail(new Error("Agent stream failed"));
            }
            writer.write(next.value);
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { "Cache-Control": "private, no-store", "x-lotse-case-id": prepared.context.caseId },
  });
}
export { TurnError } from "./errors.ts";
