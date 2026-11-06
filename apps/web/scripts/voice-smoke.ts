import { z } from "zod";
import { getEnvironment } from "../src/server/env.ts";
import { mintVoiceToken } from "../src/server/voice.ts";
import { voiceConfig } from "../src/voice/config.ts";
import { loadLocalEnvironment } from "./load-env.mjs";

// Real provider smoke test; synthetic greeting only, never user audio or documents.
loadLocalEnvironment();
const frameSchema = z.object({
  message_type: z.string().optional(),
  audio: z.string().nullable().optional(),
  is_final: z.boolean().nullable().optional(),
  isFinal: z.boolean().nullable().optional(),
});

async function exchange(url: URL, send?: (socket: WebSocket) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let bytes = 0;
    const timer = setTimeout(fail, voiceConfig.providerTimeoutMs);
    function fail(): void {
      clearTimeout(timer);
      socket.close();
      reject(new Error("VOICE_SMOKE_FAILED"));
    }
    socket.addEventListener("error", fail);
    socket.addEventListener("open", () => send?.(socket));
    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      try {
        if (typeof event.data !== "string") {
          fail();
          return;
        }
        const raw: unknown = JSON.parse(event.data);
        const data = frameSchema.parse(raw);
        if (data.audio) bytes += data.audio.length;
        if (data.message_type === "session_started" || data.is_final || data.isFinal) {
          clearTimeout(timer);
          socket.close();
          resolve(bytes);
        }
      } catch {
        fail();
      }
    });
  });
}

let stage = "configuration";
try {
  let config = getEnvironment();
  if (process.argv.includes("--discover-voice")) {
    stage = "voice-discovery";
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": config.ELEVENLABS_API_KEY ?? "" },
      signal: AbortSignal.timeout(voiceConfig.providerTimeoutMs),
    });
    if (!response.ok) throw new Error("VOICE_SMOKE_FAILED");
    const data = z
      .object({ voices: z.array(z.object({ voice_id: z.string().min(1) })).min(1) })
      .parse(await response.json());
    const voice = data.voices[0];
    if (!voice) throw new Error("VOICE_SMOKE_FAILED");
    // This invocation only: validate transport with a real available account voice.
    config = { ...config, ELEVENLABS_VOICE_ID_DE: voice.voice_id };
  }
  const signal = AbortSignal.timeout(voiceConfig.providerTimeoutMs);
  stage = "scribe-token";
  const scribe = await mintVoiceToken({ type: "realtime_scribe", language: "de" }, config, signal);
  const scribeUrl = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
  scribeUrl.searchParams.set("model_id", voiceConfig.scribeModel);
  scribeUrl.searchParams.set("token", scribe.token);
  stage = "scribe-socket";
  await exchange(scribeUrl);
  stage = "tts-token";
  const tts = await mintVoiceToken(
    { type: "tts_websocket", language: "de" },
    config,
    AbortSignal.timeout(voiceConfig.providerTimeoutMs),
  );
  if (!tts.voiceId) throw new Error("VOICE_SMOKE_FAILED");
  const url = new URL(
    `${voiceConfig.ttsSocket}${encodeURIComponent(tts.voiceId)}/multi-stream-input`,
  );
  url.searchParams.set("single_use_token", tts.token);
  url.searchParams.set("model_id", voiceConfig.ttsModel);
  url.searchParams.set("output_format", voiceConfig.outputFormat);
  stage = "tts-socket";
  const bytes = await exchange(url, (socket) => {
    socket.send(JSON.stringify({ context_id: "smoke", text: " " }));
    socket.send(JSON.stringify({ context_id: "smoke", text: "Guten Tag. ", flush: true }));
    socket.send(JSON.stringify({ context_id: "smoke", close_context: true }));
  });
  if (bytes === 0) throw new Error("VOICE_SMOKE_FAILED");
  process.stdout.write("Real Scribe session and TTS PCM audio verified with single-use tokens.\n");
} catch {
  process.stderr.write(
    `Voice provider smoke test failed at ${stage}; credentials and provider details redacted.\n`,
  );
  process.exitCode = 1;
}
