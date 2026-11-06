import { selectVoice, voiceConfiguration } from "@lotse/brain/voice";
import { voiceVocabulary } from "@lotse/knowledge/voice-vocabulary";
import { z } from "zod";
import { voiceConfig } from "../voice/config.ts";
import type { VoiceToken, VoiceTokenRequest } from "../voice/contracts.ts";
import type { ServerEnvironment } from "./env.ts";

export class VoiceUnavailable extends Error {
  constructor() {
    super("VOICE_UNAVAILABLE");
  }
}

export async function mintVoiceToken(
  input: VoiceTokenRequest,
  config: ServerEnvironment,
  signal: AbortSignal,
): Promise<VoiceToken> {
  const key = config.ELEVENLABS_API_KEY;
  const voiceId =
    input.type === "tts_websocket"
      ? (
          await selectVoice(
            input.language,
            voiceConfiguration({ ...process.env, ...config }),
            fetch,
            signal,
          ).catch(() => undefined)
        )?.voiceId
      : undefined;
  if (!key || (input.type === "tts_websocket" && !voiceId)) throw new VoiceUnavailable();
  try {
    const response = await fetch(`${voiceConfig.tokenApi}${input.type}`, {
      method: "POST",
      headers: { "xi-api-key": key },
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(voiceConfig.providerTimeoutMs)]),
    });
    if (!response.ok) throw new VoiceUnavailable();
    const { token } = z.object({ token: z.string().min(1) }).parse(await response.json());
    return {
      token,
      vocabulary: voiceVocabulary(input.language),
      expiresIn: voiceConfig.tokenLifetimeSeconds,
      ...(input.type === "tts_websocket" && voiceId ? { voiceId } : {}),
    };
  } catch {
    // Provider bodies and exception messages can contain credentials; never forward them.
    throw new VoiceUnavailable();
  }
}
