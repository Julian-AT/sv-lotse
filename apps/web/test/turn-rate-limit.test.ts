import { randomUUID } from "node:crypto";
import { SessionRateLimitError } from "@lotse/brain/subjects";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), handle: vi.fn() }));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {},
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({}) }));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("@lotse/brain/subjects", async (original) => ({
  ...(await original<typeof import("@lotse/brain/subjects")>()),
  enforceTurnRateLimit: mocks.limit,
}));
vi.mock("@lotse/brain", async (original) => ({
  ...(await original<typeof import("@lotse/brain")>()),
  handleTurn: mocks.handle,
}));

import { POST } from "../src/app/api/turn/route.ts";

const userId = randomUUID();
const sessionId = randomUUID();
const caseId = randomUUID();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId, sessionId, kind: "anonymous" });
  mocks.handle.mockResolvedValue(new Response("stream"));
});

function request(): Request {
  return new Request("https://lotse.test/api/turn", {
    method: "POST",
    body: JSON.stringify({
      caseId,
      inputKind: "text",
      capsule: {},
      actionResults: [],
      message: { parts: [{ state: "approval-responded" }] },
    }),
  });
}
test("FR-R5 turn requests use session counters and classify approval continuations before model execution", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mocks.limit).toHaveBeenCalledWith(
    {},
    { userId, sessionId, caseId, approvalAttempt: true },
  );
  expect(mocks.handle).toHaveBeenCalledOnce();
});
test("FR-R5 rejected turns return 429 and Retry-After without starting the model", async () => {
  mocks.limit.mockRejectedValue(new SessionRateLimitError());
  const response = await POST(request());
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(await response.json()).toEqual({ error: "SESSION_RATE_LIMITED" });
  expect(mocks.handle).not.toHaveBeenCalled();
});
