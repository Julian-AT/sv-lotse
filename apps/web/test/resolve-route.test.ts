import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), resolve: vi.fn() }));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("@lotse/brain/resolve", async (original) => ({
  ...(await original<typeof import("@lotse/brain/resolve")>()),
  resolveTarget: mocks.resolve,
}));

import { POST } from "../src/app/api/resolve/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://lotse.test/api/resolve", { method: "POST", body, headers });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "caller", sessionId: "session", kind: "anonymous" });
  mocks.resolve.mockResolvedValue({ point: null });
});
test("FR-C3 resolve authenticates before reading the screenshot", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect((await POST(request("{}"))).status).toBe(401);
  expect(mocks.resolve).not.toHaveBeenCalled();
});
test("FR-C3 resolve rejects cross-origin calls before passing images to the brain", async () => {
  expect((await POST(request("{}", { origin: "https://untrusted.test" }))).status).toBe(403);
  expect((await POST(request("{}", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  expect(mocks.resolve).not.toHaveBeenCalled();
});
test("FR-C3 resolve bounds chunked input even without a Content-Length header", async () => {
  expect((await POST(request("x".repeat(2_800_001)))).status).toBe(413);
  expect(mocks.resolve).not.toHaveBeenCalled();
});
test("FR-C3 resolve is private and maps unexpected errors without exposing screenshot content", async () => {
  const result = await POST(request("{}", { origin: "https://lotse.test" }));
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(await result.json()).toEqual({ point: null });
  mocks.resolve.mockRejectedValue(new Error("private screenshot text"));
  const failed = await POST(request("{}"));
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "RESOLVE_FAILED" });
});
