import { turns } from "@lotse/db/schema";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
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
} from "../runtime/helpers.ts";

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

test("NFR-12 persists token usage, latency and cost completeness for each real database turn", async () => {
  const database = await isolatedDatabase();
  try {
    const session = await identity(database.db);
    let completed = false;
    const response = await handleTurn(
      await confirmedRequest(database.db, session),
      userMessage(),
      session,
      {
        db: database.db,
        config,
        model: forcedModel(),
        onTurnComplete: async (metrics) => {
          completed = true;
          expect(metrics.inputTokens).toBeGreaterThan(0);
        },
      },
    );
    const caseId = response.headers.get("x-lotse-case-id");
    if (!caseId) throw new Error("Missing case id");
    await chunks(response);
    const [row] = await database.db.select().from(turns).where(eq(turns.caseId, caseId));
    expect(row?.status).toBe("completed");
    expect(row?.timings).toMatchObject({
      costComplete: false,
      unpricedCalls: 1,
      modelCalls: 1,
      toolCount: 0,
    });
    expect(row?.timings.inputTokens).toBeGreaterThan(0);
    expect(row?.timings.latencyMs).toBeGreaterThan(0);
    expect(completed).toBe(true);
    expect(JSON.stringify(row?.timings)).not.toContain("Verwaltungsunterlagen");
    // A test-only model with a real priced model id proves persisted USD accounting.
    const priced = new MockLanguageModelV4({
      modelId: "gpt-5.4-mini",
      doStream: forcedModel().doStream,
    });
    await chunks(
      await handleTurn({ ...turn, caseId }, userMessage(), session, {
        db: database.db,
        config,
        model: priced,
        languageModel: forcedModel(),
      }),
    );
    const rows = await database.db
      .select()
      .from(turns)
      .where(eq(turns.caseId, caseId))
      .orderBy(turns.createdAt);
    expect(rows.at(-1)?.timings).toMatchObject({
      costComplete: true,
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(rows.at(-1)?.timings.costUsd).toBeCloseTo(0.00000525);
    expect(rows.at(-1)?.timings.caseCostUsd).toBeCloseTo(0.00000525);
  } finally {
    await database.cleanup();
  }
});
