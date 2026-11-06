import { voiceVocabulary } from "@lotse/knowledge/voice-vocabulary";
import { beforeEach, expect, test, vi } from "vitest";
import { VOICE_TOKEN_LIMIT, VOICE_TOKEN_WINDOW_MS } from "../../src/voice/config.ts";
import {
  createVoiceToken,
  createVoiceTokenLimiter,
  resetVoiceCache,
  VoiceTokenRequestSchema,
  voiceConfiguration,
} from "../../src/voice/index.ts";
import { pickVoice } from "../../src/voice/select.ts";

beforeEach(() => {
  resetVoiceCache();
});

const config = voiceConfiguration({
  ELEVENLABS_API_KEY: "test-provider-key",
  ELEVENLABS_VOICE_ID_DE: "german-voice",
});
test("FR-C1 issues only a single-use Scribe credential and never returns the provider key", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ token: "single-use", internal: "ignored" }));
  const result = await createVoiceToken(
    VoiceTokenRequestSchema.parse({}),
    config,
    undefined,
    fetcher,
  );
  expect(result).toEqual({ token: "single-use", vocabulary: voiceVocabulary("de") });
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    expect.objectContaining({
      method: "POST",
      headers: { "xi-api-key": "test-provider-key" },
      cache: "no-store",
    }),
  );
});
test("FR-C4 returns the configured voice and model alongside a fresh TTS token", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith("/voices")
        ? Response.json({ voices: [{ voice_id: "german-voice" }] })
        : Response.json({ token: "tts-single-use" }),
    );
  const result = await createVoiceToken(
    VoiceTokenRequestSchema.parse({ type: "tts_websocket" }),
    config,
    undefined,
    fetcher,
  );
  expect(result).toEqual({
    token: "tts-single-use",
    voiceId: "german-voice",
    vocabulary: voiceVocabulary("de"),
    modelId: "eleven_flash_v2_5",
  });
});
test("missing voice configuration without account voices fails before a paid provider request", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ voices: [] }));
  await expect(
    createVoiceToken(
      VoiceTokenRequestSchema.parse({ type: "tts_websocket", language: "en" }),
      config,
      undefined,
      fetcher,
    ),
  ).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE", status: 503 });
  expect(fetcher).not.toHaveBeenCalledWith(
    expect.stringContaining("single-use-token"),
    expect.anything(),
  );
});
const accountVoices = {
  voices: [
    { voice_id: "cloned-en", category: "cloned", labels: { accent: "american" } },
    {
      voice_id: "premade-de",
      category: "premade",
      labels: { accent: "german", use_case: "conversational" },
    },
    { voice_id: "premade-multi", category: "premade", labels: { description: "multilingual" } },
  ],
};
function accountFetcher() {
  return vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/voices")
      ? Response.json(accountVoices)
      : Response.json({ token: "tts-single-use" }),
  );
}
test("a configured voice missing on the account falls back to the best voice for the language", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const fetcher = accountFetcher();
  const stale = voiceConfiguration({
    ELEVENLABS_API_KEY: "test-provider-key",
    ELEVENLABS_VOICE_ID_DE: "deleted-voice",
    ELEVENLABS_VOICE_ID_EN: "deleted-voice-en",
  });
  const de = await createVoiceToken(
    VoiceTokenRequestSchema.parse({ type: "tts_websocket" }),
    stale,
    undefined,
    fetcher,
  );
  const en = await createVoiceToken(
    VoiceTokenRequestSchema.parse({ type: "tts_websocket", language: "en" }),
    stale,
    undefined,
    fetcher,
  );
  expect(de.voiceId).toBe("premade-de");
  expect(en.voiceId).toBe("cloned-en");
  // The account list is cached: one list request for both tokens.
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/voices"))).toHaveLength(1);
  expect(info.mock.calls.map(([line]) => String(line)).join("\n")).not.toContain(
    "test-provider-key",
  );
  info.mockRestore();
});
test("a configured voice present on the account is kept", async () => {
  const fetcher = accountFetcher();
  const result = await createVoiceToken(
    VoiceTokenRequestSchema.parse({ type: "tts_websocket" }),
    voiceConfiguration({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID_DE: "premade-multi" }),
    undefined,
    fetcher,
  );
  expect(result.voiceId).toBe("premade-multi");
});
test("without language hints the first account voice is chosen", () => {
  expect(pickVoice([{ voice_id: "a" }, { voice_id: "b" }], "de")).toBe("a");
});
test("provider response and transport failures expose only a fixed error code", async () => {
  for (const response of [
    Response.json({ token: "" }),
    Response.json({ detail: "private" }, { status: 401 }),
  ]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      createVoiceToken(VoiceTokenRequestSchema.parse({}), config, undefined, fetcher),
    ).rejects.toMatchObject({ message: "VOICE_UNAVAILABLE", status: 503 });
  }
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private-provider-content"));
  await expect(
    createVoiceToken(VoiceTokenRequestSchema.parse({}), config, undefined, fetcher),
  ).rejects.toMatchObject({ message: "VOICE_UNAVAILABLE" });
});
test("tokens are rate-limited per authenticated session and recover in the next window", () => {
  const limit = createVoiceTokenLimiter();
  for (let index = 0; index < VOICE_TOKEN_LIMIT; index += 1) limit("session", 0);
  expect(() => limit("session", 0)).toThrow("VOICE_RATE_LIMITED");
  expect(() => limit("another-session", 0)).not.toThrow();
  expect(() => limit("session", VOICE_TOKEN_WINDOW_MS)).not.toThrow();
});
test("the token boundary refuses arbitrary provider paths and unsupported languages", () => {
  expect(VoiceTokenRequestSchema.safeParse({ type: "../voices" }).success).toBe(false);
  expect(VoiceTokenRequestSchema.safeParse({ language: "arbitrary" }).success).toBe(false);
  expect(VoiceTokenRequestSchema.safeParse({ userId: "caller-controlled" }).success).toBe(false);
});
