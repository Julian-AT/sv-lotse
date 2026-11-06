import { voiceConfig } from "./config.ts";
import { type VoiceToken, type VoiceTokenRequest, VoiceTokenSchema } from "./contracts.ts";

export async function fetchVoiceToken(
  input: VoiceTokenRequest,
  signal: AbortSignal,
): Promise<VoiceToken> {
  const response = await fetch(voiceConfig.tokenEndpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(voiceConfig.providerTimeoutMs)]),
  });
  if (!response.ok) throw new Error("VOICE_UNAVAILABLE");
  return VoiceTokenSchema.parse(await response.json());
}
