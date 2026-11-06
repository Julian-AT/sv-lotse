import { randomUUID } from "node:crypto";
import { approvals, messages, sessions } from "@lotse/db/schema";
import { isToolUIPart } from "ai";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCaseConversation } from "../../src/conversation/continuity.ts";
import { handleTurn } from "../../src/conversation/index.ts";
import {
  chunks,
  config,
  confirmedRequest,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
  userMessage,
} from "./helpers.ts";

// Real Postgres authority tests use isolated classifier/guard doubles; live pipeline tests call providers.
vi.mock("../../src/pipeline/classify.ts", () => ({
  classifyInput: async () => ({
    language: "de-AT",
    intent: "administrative",
    lifeSituation: null,
    candidateGoal: null,
    confirmsPendingGoal: false,
    factTypes: [],
  }),
}));
vi.mock("../../src/pipeline/guards.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/pipeline/guards.ts")>()),
  guardAnswer: async (_config: unknown, text: string) => text,
}));

describe("FR-C9 / NFR-4 cross-client continuity on real Postgres", () => {
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  beforeAll(async () => {
    database = await isolatedDatabase();
  });
  afterAll(async () => {
    if (database) await database.cleanup();
  });
  async function fixture() {
    const session = await identity(database.db);
    const message = userMessage();
    const response = await handleTurn(
      await confirmedRequest(database.db, session),
      message,
      session,
      {
        db: database.db,
        config,
        model: forcedModel("ui.fill"),
      },
    );
    await chunks(response);
    const caseId = response.headers.get("x-lotse-case-id");
    if (!caseId) throw new Error("Missing case id");
    const second = { ...session, sessionId: randomUUID() };
    await database.db.insert(sessions).values({
      id: second.sessionId,
      userId: second.userId,
      clientKind: "mac",
      expiresAt: new Date(Date.now() + 3600000),
    });
    return { session, second, caseId, message };
  }
  it("reloads exact persisted messages and transfers pending approvals only on explicit resume", async () => {
    const flow = await fixture();
    const original = await loadCaseConversation(database.db, flow.caseId, flow.session);
    expect(original.messages[0]).toEqual(flow.message);
    expect(await loadCaseConversation(database.db, flow.caseId, flow.second)).toEqual(original);
    const before = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.caseId, flow.caseId));
    expect(before[0]?.sessionId).toBe(flow.session.sessionId);
    const resumed = await loadCaseConversation(database.db, flow.caseId, flow.second, true);
    expect(resumed.messages).toEqual(original.messages);
    const latest = structuredClone(resumed.messages.at(-1));
    if (!latest) throw new Error("Missing assistant");
    latest.parts = latest.parts.map((part) =>
      isToolUIPart(part) && part.state === "approval-requested"
        ? {
            ...part,
            state: "approval-responded" as const,
            approval: { ...part.approval, approved: true },
          }
        : part,
    );
    await expect(
      handleTurn({ ...turn, caseId: flow.caseId }, latest, flow.session, {
        db: database.db,
        config,
        model: forcedModel(),
      }),
    ).rejects.toMatchObject({ code: "CONTINUATION_REJECTED" });
    const result = await chunks(
      await handleTurn({ ...turn, caseId: flow.caseId }, latest, flow.second, {
        db: database.db,
        config,
        model: forcedModel(),
      }),
    );
    expect(result).toContainEqual(
      expect.objectContaining({ type: "tool-input-available", toolName: "ui.fill" }),
    );
    const [consumed] = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.caseId, flow.caseId));
    expect(consumed).toMatchObject({ sessionId: flow.second.sessionId, decision: "approved" });
    expect(consumed?.consumedAt).toBeInstanceOf(Date);
    const recovered = await loadCaseConversation(database.db, flow.caseId, flow.session, true);
    expect(recovered.messages.at(-1)?.parts).toContainEqual(
      expect.objectContaining({ state: "output-error", errorText: "TOOL_INTERRUPTED" }),
    );
    const [after] = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.caseId, flow.caseId));
    expect(after?.sessionId).toBe(flow.second.sessionId);
  });
  it("rejects unrelated and expired sessions before exposing history or rebinding approvals", async () => {
    const flow = await fixture();
    await expect(
      loadCaseConversation(database.db, flow.caseId, await identity(database.db), true),
    ).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
    await database.db
      .update(sessions)
      .set({ createdAt: new Date(0), expiresAt: new Date(1) })
      .where(eq(sessions.id, flow.second.sessionId));
    await expect(
      loadCaseConversation(database.db, flow.caseId, flow.second, true),
    ).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
    const [pending] = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.caseId, flow.caseId));
    expect(pending).toMatchObject({
      sessionId: flow.session.sessionId,
      decision: "pending",
      consumedAt: null,
    });
  });
  it("resolves unfinished ungated client calls without reading the previous client's screen", async () => {
    const flow = await fixture();
    const before = await loadCaseConversation(database.db, flow.caseId, flow.session);
    const assistant = before.messages.at(-1);
    if (!assistant) throw new Error("Missing assistant");
    const toolCallId = randomUUID();
    assistant.parts = [
      {
        type: "dynamic-tool",
        toolName: "context.readPage",
        toolCallId,
        state: "input-available",
        input: {},
      },
    ];
    await database.db
      .update(messages)
      .set({ uiMessage: assistant })
      .where(
        and(eq(messages.caseId, flow.caseId), eq(messages.position, before.messages.length - 1)),
      );
    const resumed = await loadCaseConversation(database.db, flow.caseId, flow.second, true);
    expect(resumed.messages.at(-1)?.parts).toContainEqual(
      expect.objectContaining({ toolCallId, state: "output-error", errorText: "TOOL_INTERRUPTED" }),
    );
    const stream = await chunks(
      await handleTurn({ ...turn, caseId: flow.caseId }, userMessage(), flow.second, {
        db: database.db,
        config,
        model: forcedModel(),
      }),
    );
    expect(stream.some((part) => part.type === "text-delta")).toBe(true);
    expect(stream.some((part) => part.type === "tool-input-available")).toBe(false);
  });
});
