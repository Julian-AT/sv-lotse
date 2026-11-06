import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { handleTurn } from "../../src/conversation/index.ts";
import {
  chunks,
  config,
  confirmedRequest,
  forcedModel,
  identity,
  isolatedDatabase,
  userMessage,
} from "../runtime/helpers.ts";

// Only model/provider boundaries are doubled. Production context, stream guard validation,
// persistence and turn finalization run against real Postgres.
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
vi.mock("../../src/retrieval/index.ts", async (original) => ({
  ...(await original<typeof import("../../src/retrieval/index.ts")>()),
  searchKnowledge: async () => [
    {
      id: "official-passage",
      text: "An administrative source passage.",
      url: "https://www.gesundheit.gv.at/",
      validFrom: "2026-01-01",
      validTo: null,
    },
  ],
}));
vi.mock("../../src/pipeline/guards.ts", async (original) => ({
  ...(await original<typeof import("../../src/pipeline/guards.ts")>()),
  guardAnswer: async (_config: unknown, text: string) => text,
}));
vi.mock("../../src/guards/classifier.ts", async (original) => ({
  ...(await original<typeof import("../../src/guards/classifier.ts")>()),
  createBoundaryClassifier: () => async () => ({
    violation: false,
    score: 0,
    category: "none",
    responseKind: "administrative",
  }),
}));
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  await database?.cleanup();
});

it("retrieved validity metadata does not crash the response guard or suppress the persisted answer", async () => {
  const session = await identity(database.db);
  const response = await handleTurn(
    await confirmedRequest(database.db, session),
    userMessage(),
    session,
    { db: database.db, config, model: forcedModel() },
  );
  const stream = await chunks(response);
  expect(stream.some((part) => part.type === "error")).toBe(false);
  expect(
    stream
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join(""),
  ).toContain("Verwaltungsunterlagen");
  const caseId = response.headers.get("x-lotse-case-id");
  const [record] = await database.sql`select status from turn where case_id = ${caseId}`;
  expect(record?.status).toBe("completed");
});
