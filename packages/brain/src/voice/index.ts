import { type VoiceVocabulary, voiceVocabulary } from "@lotse/knowledge/voice-vocabulary";
import { z } from "zod";
import {
  VOICE_API_BASE,
  VOICE_REQUEST_TIMEOUT_MS,
  VOICE_TOKEN_LIMIT,
  VOICE_TOKEN_WINDOW_MS,
  type VoiceConfiguration,
  VoiceError,
} from "./config.ts";
import { selectVoice } from "./select.ts";

export { VoiceError, voiceConfiguration } from "./config.ts";
export { resetVoiceCache, selectVoice, type VoiceSelection } from "./select.ts";
export const VoiceTokenRequestSchema = z.strictObject({
  type: z.enum(["realtime_scribe", "tts_websocket"]).default("realtime_scribe"),
  language: z.enum(["de", "en"]).default("de"),
});
export type VoiceTokenRequest = z.infer<typeof VoiceTokenRequestSchema>;
const tokenResponse = z.object({ token: z.string().min(1) });
export interface VoiceToken {
  token: string;
  voiceId?: string;
  modelId?: string;
  vocabulary: VoiceVocabulary;
}

/** Bound by authenticated session; the caller never supplies the rate-limit identity. */
export function createVoiceTokenLimiter(): (sessionId: string, now?: number) => void {
  const windows = new Map<string, { start: number; count: number }>();
  return (sessionId, now = Date.now()) => {
    for (const [key, window] of windows) {
      if (now - window.start >= VOICE_TOKEN_WINDOW_MS) windows.delete(key);
    }
    const window = windows.get(sessionId) ?? { start: now, count: 0 };
    if (window.count >= VOICE_TOKEN_LIMIT) throw new VoiceError("VOICE_RATE_LIMITED", 429);
    window.count += 1;
    windows.set(sessionId, window);
  };
}

export async function createVoiceToken(
  input: VoiceTokenRequest,
  config: VoiceConfiguration,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<VoiceToken> {
  if (!config.ELEVENLABS_API_KEY) throw new VoiceError("VOICE_UNAVAILABLE", 503);
  const voiceId =
    input.type === "tts_websocket"
      ? (await selectVoice(input.language, config, fetcher, signal))?.voiceId
      : undefined;
  if (input.type === "tts_websocket" && !voiceId) throw new VoiceError("VOICE_UNAVAILABLE", 503);
  try {
    const timeout = AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS);
    const response = await fetcher(`${VOICE_API_BASE}/single-use-token/${input.type}`, {
      method: "POST",
      headers: { "xi-api-key": config.ELEVENLABS_API_KEY },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
    if (!response.ok) throw new VoiceError("VOICE_UNAVAILABLE", 503);
    const parsed = tokenResponse.safeParse(await response.json());
    if (!parsed.success) throw new VoiceError("VOICE_UNAVAILABLE", 503);
    return input.type === "tts_websocket"
      ? {
          token: parsed.data.token,
          vocabulary: voiceVocabulary(input.language),
          ...(voiceId ? { voiceId } : {}),
          modelId: config.ELEVENLABS_TTS_MODEL,
        }
      : { token: parsed.data.token, vocabulary: voiceVocabulary(input.language) };
  } catch {
    // Provider errors can contain credentials and request content. Never propagate them.
    throw new VoiceError("VOICE_UNAVAILABLE", 503);
  }
}
