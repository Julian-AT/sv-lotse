import { randomUUID } from "node:crypto";
import { cases } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { handleTurn } from "../../src/conversation/index.ts";
import {
  chunks,
  config,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
  userMessage,
} from "../runtime/helpers.ts";

const { classify, search } = vi.hoisted(() => ({ classify: vi.fn(), search: vi.fn() }));
vi.mock("../../src/pipeline/classify.ts", () => ({ classifyInput: classify }));
vi.mock("../../src/retrieval/index.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/retrieval/index.ts")>()),
  searchKnowledge: search,
}));
vi.mock("../../src/pipeline/guards.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/pipeline/guards.ts")>()),
  guardAnswer: async (_config: unknown, text: string) => text,
}));
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  await database?.cleanup();
});
it("FR-G7 answers first and offers the goal; a yes confirms it and retrieves the goal", async () => {
  const session = await identity(database.db);
  const goal = "Administrative document preparation";
  classify.mockResolvedValue({
    language: "de-AT",
    intent: "administrative",
    lifeSituation: null,
    candidateGoal: goal,
    confirmsPendingGoal: false,
    factTypes: [],
  });
  search.mockResolvedValue([]);
  const first = await handleTurn(turn, userMessage(), session, {
    db: database.db,
    config,
    model: forcedModel(),
  });
  const caseId = first.headers.get("x-lotse-case-id");
  if (!caseId) throw new Error("Missing case id");
  const answered = await chunks(first);
  // The first message is answered directly; the goal is only offered, never asked separately.
  expect(search).toHaveBeenCalledWith(
    database.db,
    config,
    expect.objectContaining({ query: userMessage().parts[0]?.text }),
    undefined,
  );
  expect(answered).toContainEqual(
    expect.objectContaining({
      type: "message-metadata",
      messageMetadata: expect.objectContaining({ pendingGoal: goal }),
    }),
  );
  const [open] = await database.db.select().from(cases).where(eq(cases.id, caseId));
  expect(open?.confirmedGoal).toBe("");
  search.mockClear();
  classify.mockResolvedValue({
    language: "de-AT",
    intent: "administrative",
    lifeSituation: null,
    candidateGoal: null,
    confirmsPendingGoal: true,
    factTypes: [],
  });
  const confirm = {
    id: randomUUID(),
    role: "user",
    parts: [{ type: "text", text: "Ja, genau, bitte nennen Sie die Quelle." }],
  };
  const response = await handleTurn({ ...turn, caseId }, confirm, session, {
    db: database.db,
    config,
    model: forcedModel(),
  });
  const output = await chunks(response);
  expect(output.some((part) => part.type === "error")).toBe(false);
  expect(search).toHaveBeenCalledWith(
    database.db,
    config,
    expect.objectContaining({ query: goal }),
    undefined,
  );
  const [record] = await database.db.select().from(cases).where(eq(cases.id, caseId));
  expect(record?.confirmedGoal).toBe(goal);
});
