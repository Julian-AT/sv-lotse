import { randomUUID } from "node:crypto";
import { voiceVocabulary } from "@lotse/knowledge/voice-vocabulary";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), fetch: vi.fn() }));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({
    LOTSE_WORKSPACE_URL: "https://lotse.test",
    ELEVENLABS_API_KEY: "test-provider-key",
    ELEVENLABS_VOICE_ID_DE: "test-german-voice",
    ELEVENLABS_VOICE_ID_EN: "test-english-voice",
  }),
}));

import { POST } from "../src/app/api/voice/token/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

function request(body: unknown = {}, origin = "https://lotse.test"): Request {
  return new Request("https://lotse.test/api/voice/token", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5");
  mocks.session.mockResolvedValue({
    sessionId: randomUUID(),
    userId: randomUUID(),
    kind: "anonymous",
  });
  mocks.fetch.mockImplementation(async () => Response.json({ token: "test-single-use-token" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test.each(["realtime_scribe", "tts_websocket"])(
  "FR-C4 mints %s with server credentials and no-store",
  async (type) => {
    const response = await POST(request({ type, language: "en" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Origin");
    const payload: unknown = await response.json();
    expect(payload).toEqual({
      token: "test-single-use-token",
      expiresIn: 900,
      vocabulary: voiceVocabulary("en"),
      ...(type === "tts_websocket"
        ? { voiceId: "test-english-voice", modelId: "eleven_flash_v2_5" }
        : {}),
    });
    expect(JSON.stringify(payload)).not.toContain("test-provider-key");
    expect(mocks.fetch).toHaveBeenCalledWith(
      `https://api.elevenlabs.io/v1/single-use-token/${type}`,
      expect.objectContaining({
        method: "POST",
        headers: { "xi-api-key": "test-provider-key" },
        cache: "no-store",
      }),
    );
  },
);

test("requires a session before minting a paid provider token", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect((await POST(request({ type: "realtime_scribe" }))).status).toBe(401);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
test("rejects cross-origin minting and arbitrary provider paths", async () => {
  expect((await POST(request({ type: "tts_websocket" }, "https://other.test"))).status).toBe(403);
  expect((await POST(request({ type: "../voices" }))).status).toBe(400);
  expect((await POST(request({ type: "realtime_scribe", userId: "untrusted" }))).status).toBe(400);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
test("redacts provider failures and invalid token bodies", async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({ detail: "private provider error" }, { status: 401 }),
  );
  const response = await POST(request({ type: "tts_websocket" }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "VOICE_UNAVAILABLE" });
  mocks.fetch.mockResolvedValue(Response.json({ token: "" }));
  expect((await POST(request({ type: "realtime_scribe" }))).status).toBe(503);
});
test("FR-C1 native and browser clients receive a private uncached token using their session", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    token: "test-single-use-token",
    expiresIn: 900,
    vocabulary: voiceVocabulary("de"),
  });
});
test("unauthenticated callers cannot mint provider credentials", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect((await POST(request())).status).toBe(401);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
test("cross-origin requests and invalid token types never reach the provider", async () => {
  expect((await POST(request({}, "https://other.test"))).status).toBe(403);
  expect((await POST(request({ type: "invalid" }))).status).toBe(400);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
test("unexpected failures cannot expose provider credentials or content", async () => {
  mocks.fetch.mockRejectedValue(new Error("private-content"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "VOICE_UNAVAILABLE" });
});
test("limits token minting per authenticated session and keeps other sessions independent", async () => {
  for (let index = 0; index < 30; index += 1) {
    expect((await POST(request())).status).toBe(200);
  }
  const response = await POST(request());
  expect(response.status).toBe(429);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: "VOICE_RATE_LIMITED" });
  expect(mocks.fetch).toHaveBeenCalledTimes(30);
  mocks.session.mockResolvedValue({
    sessionId: randomUUID(),
    userId: randomUUID(),
    kind: "anonymous",
  });
  expect((await POST(request())).status).toBe(200);
});
