import { approvals, messages } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleTurn } from "../../src/conversation/index.ts";
import { safetyNotice } from "../../src/guards/index.ts";
import {
  chunks,
  config,
  confirmedRequest,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
  userMessage,
} from "../runtime/helpers.ts";

// SR-1 is checked against real Postgres without provider calls: the classifier and answer guard
// get isolated doubles, the safety net itself stays real.
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

describe("SR-1 persisted real turn stream", () => {
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  beforeAll(async () => {
    database = await isolatedDatabase();
  });
  afterAll(async () => {
    if (database) await database.cleanup();
  });
  it("a pending approval cannot prevent SR-1 or dispatch the paused action", async () => {
    const session = await identity(database.db);
    const model = forcedModel("ui.fill");
    // Tools run only for a confirmed administrative goal, so start from one.
    const request = await confirmedRequest(database.db, session);
    const pendingResponse = await handleTurn(request, userMessage(), session, {
      db: database.db,
      config,
      model,
    });
    const caseId = pendingResponse.headers.get("x-lotse-case-id");
    if (!caseId) throw new Error("Missing case id");
    await chunks(pendingResponse);
    const calls = model.doStreamCalls.length;
    const latest = userMessage();
    latest.parts[0] = { type: "text", text: "Ich will mich jetzt umbringen." };
    const interrupted = await chunks(
      await handleTurn({ ...turn, caseId }, latest, session, { db: database.db, config, model }),
    );
    expect(interrupted.filter((part) => part.type === "data-safety-notice")).toHaveLength(1);
    expect(interrupted.some((part) => part.type === "tool-input-available")).toBe(false);
    expect(model.doStreamCalls).toHaveLength(calls);
    const replay = await chunks(
      await handleTurn({ ...turn, caseId }, latest, session, { db: database.db, config, model }),
    );
    expect(replay.some((part) => part.type === "data-safety-notice")).toBe(false);
    const [approval] = await database.db
      .select()
      .from(approvals)
      .where(eq(approvals.caseId, caseId));
    expect(approval).toMatchObject({ decision: "pending", consumedAt: null });
    const rows = await database.db
      .select()
      .from(messages)
      .where(eq(messages.caseId, caseId))
      .orderBy(messages.position);
    expect(JSON.stringify(rows.at(-1)?.uiMessage)).toContain("administrative_only");
  });
  it("emits and persists one typed fixed notice before making any model call", async () => {
    const session = await identity(database.db);
    const model = forcedModel();
    const latest = userMessage();
    latest.parts[0] = { type: "text", text: "I want to kill myself right now." };
    const response = await handleTurn({ ...turn, language: "en" }, latest, session, {
      db: database.db,
      config,
      model,
    });
    const caseId = response.headers.get("x-lotse-case-id");
    if (!caseId) throw new Error("Missing case id");
    const stream = await chunks(response);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(stream.filter((part) => part.type === "data-safety-notice")).toEqual([
      { type: "data-safety-notice", id: latest.id, data: safetyNotice("en") },
    ]);
    expect(stream.some((part) => part.type === "text-delta")).toBe(false);
    const rows = await database.db
      .select()
      .from(messages)
      .where(eq(messages.caseId, caseId))
      .orderBy(messages.position);
    expect(rows.at(-1)?.uiMessage).toMatchObject({
      role: "assistant",
      parts: [{ type: "data-safety-notice", data: { scopeAfter: "administrative_only" } }],
    });
    // The next administrative turn must neither repeat the notice nor lose the persisted scope.
    const continued = await chunks(
      await handleTurn({ ...turn, caseId }, userMessage(), session, {
        db: database.db,
        config,
        model,
      }),
    );
    expect(continued.some((part) => part.type === "data-safety-notice")).toBe(false);
    expect(continued.some((part) => part.type === "text-delta")).toBe(true);
  });
});
