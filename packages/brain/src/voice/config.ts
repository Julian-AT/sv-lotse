import { z } from "zod";

export const VOICE_API_BASE = "https://api.elevenlabs.io/v1";
export const VOICE_REQUEST_TIMEOUT_MS = 10_000;
export const VOICE_TOKEN_LIMIT = 30;
export const VOICE_TOKEN_WINDOW_MS = 60_000;
export const VOICE_TTS_MODEL = "eleven_flash_v2_5";
const optionalSetting = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const schema = z.object({
  ELEVENLABS_API_KEY: optionalSetting,
  ELEVENLABS_VOICE_ID_DE: optionalSetting,
  ELEVENLABS_VOICE_ID_EN: optionalSetting,
  ELEVENLABS_TTS_MODEL: z.string().min(1).default(VOICE_TTS_MODEL),
});
export type VoiceConfiguration = z.infer<typeof schema>;
export function voiceConfiguration(environment: Record<string, unknown>): VoiceConfiguration {
  const result = schema.safeParse(environment);
  if (!result.success) throw new VoiceError("VOICE_CONFIGURATION", 503);
  return result.data;
}
export class VoiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "VoiceError";
  }
}
