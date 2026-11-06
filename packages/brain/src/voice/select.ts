import { z } from "zod";
import { VOICE_API_BASE, VOICE_REQUEST_TIMEOUT_MS, type VoiceConfiguration } from "./config.ts";

export const VOICE_LIST_TTL_MS = 10 * 60_000;
export type VoiceLanguage = "de" | "en";
const voiceSchema = z.object({
  voice_id: z.string().min(1),
  name: z.string().optional(),
  category: z.string().nullish(),
  labels: z.record(z.string(), z.string().nullish()).nullish(),
  verified_languages: z
    .array(z.object({ language: z.string().nullish(), accent: z.string().nullish() }))
    .nullish(),
  high_quality_base_model_ids: z.array(z.string()).nullish(),
});
type AccountVoice = z.infer<typeof voiceSchema>;
const listSchema = z.object({ voices: z.array(voiceSchema) });

let cache: { key: string; expiresAt: number; voices: AccountVoice[] } | undefined;
const logged = new Map<VoiceLanguage, string>();

/** Test hook: forget the cached account voices. */
export function resetVoiceCache(): void {
  cache = undefined;
  logged.clear();
}

async function accountVoices(
  apiKey: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  now = Date.now(),
): Promise<AccountVoice[]> {
  if (cache && cache.key === apiKey && cache.expiresAt > now) return cache.voices;
  const timeout = AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS);
  const response = await fetcher(`${VOICE_API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("VOICE_LIST_UNAVAILABLE");
  const { voices } = listSchema.parse(await response.json());
  cache = { key: apiKey, expiresAt: now + VOICE_LIST_TTL_MS, voices };
  return voices;
}

function score(voice: AccountVoice, language: VoiceLanguage): number {
  const labels = Object.values(voice.labels ?? {})
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const verified = (voice.verified_languages ?? []).some(
    (entry) => entry.language?.toLowerCase().startsWith(language) ?? false,
  );
  const native =
    language === "de"
      ? /\b(german|deutsch|austrian|österreich)/u.test(labels) ||
        voice.labels?.language?.toLowerCase() === "de"
      : /\b(american|british|english)/u.test(labels) ||
        voice.labels?.language?.toLowerCase() === "en";
  const multilingual =
    /multilingual/u.test(labels) ||
    (voice.high_quality_base_model_ids ?? []).some((id) =>
      /multilingual|flash_v2_5|turbo_v2_5/u.test(id),
    );
  return (
    (native ? 8 : 0) +
    (verified ? 4 : 0) +
    (multilingual ? 2 : 0) +
    (voice.category === "premade" ? 1 : 0) +
    (/conversational|narrat|informative|calm/u.test(labels) ? 1 : 0)
  );
}

/** Best account voice for the language; the first account voice when nothing fits better. */
export function pickVoice(
  voices: readonly AccountVoice[],
  language: VoiceLanguage,
): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const voice of voices) {
    const value = score(voice, language);
    if (!best || value > best.score) best = { id: voice.voice_id, score: value };
  }
  return best?.id;
}

export interface VoiceSelection {
  voiceId: string;
  source: "configured" | "fallback";
}

/**
 * Uses the configured voice when the account has it. Otherwise (unset or not on the account)
 * falls back to the best available voice for the language. The account list is cached 10 min.
 */
export async function selectVoice(
  language: VoiceLanguage,
  config: VoiceConfiguration,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<VoiceSelection | undefined> {
  const configured =
    language === "en" ? config.ELEVENLABS_VOICE_ID_EN : config.ELEVENLABS_VOICE_ID_DE;
  if (!config.ELEVENLABS_API_KEY) return undefined;
  let voices: AccountVoice[];
  try {
    voices = await accountVoices(config.ELEVENLABS_API_KEY, fetcher, signal);
  } catch {
    signal?.throwIfAborted();
    // The account list is unavailable: keep the configured voice rather than failing speech.
    return configured ? { voiceId: configured, source: "configured" } : undefined;
  }
  const selection: VoiceSelection | undefined =
    configured && voices.some((voice) => voice.voice_id === configured)
      ? { voiceId: configured, source: "configured" }
      : (() => {
          const id = pickVoice(voices, language);
          return id ? { voiceId: id, source: "fallback" as const } : undefined;
        })();
  if (selection && logged.get(language) !== selection.voiceId) {
    logged.set(language, selection.voiceId);
    console.info(
      JSON.stringify({
        event: "voice_selected",
        language,
        source: selection.source,
        voiceId: selection.voiceId,
        ...(configured && selection.source === "fallback" ? { configuredVoiceId: configured } : {}),
      }),
    );
  }
  return selection;
}
