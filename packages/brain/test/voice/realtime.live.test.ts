import { expect, test } from "vitest";
import { z } from "zod";
import {
  createVoiceToken,
  VoiceTokenRequestSchema,
  voiceConfiguration,
} from "../../src/voice/index.ts";

const speechEvent = z.object({
  audio: z.string().nullish(),
  contextId: z.string().optional(),
  isFinal: z.boolean().optional(),
  message_type: z.string().optional(),
  text: z.string().optional(),
});
type SpeechEvent = z.infer<typeof speechEvent>;
class LiveSocket {
  readonly socket: WebSocket;
  private readonly pending: SpeechEvent[] = [];
  private waiter:
    | { resolve: (event: SpeechEvent) => void; reject: (error: Error) => void }
    | undefined;
  private failed = false;
  constructor(url: URL) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (message) => {
      try {
        const raw: unknown = JSON.parse(String(message.data));
        const rejection = z.object({ error: z.string().regex(/^[a-z_]{1,50}$/) }).safeParse(raw);
        if (rejection.success) {
          this.fail(`LIVE_VOICE_REJECTED_${rejection.data.error}`);
          return;
        }
        const event = speechEvent.parse(raw);
        if (this.waiter) {
          const waiter = this.waiter;
          this.waiter = undefined;
          waiter.resolve(event);
        } else this.pending.push(event);
      } catch {
        this.fail();
      }
    });
    this.socket.addEventListener("error", () => this.fail());
    this.socket.addEventListener("close", (event) => this.fail(`LIVE_VOICE_CLOSED_${event.code}`));
  }
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener(
        "error",
        () => reject(new Error("LIVE_VOICE_CONNECTION_FAILED")),
        { once: true },
      );
    });
  }
  next(): Promise<SpeechEvent> {
    const event = this.pending.shift();
    if (event) return Promise.resolve(event);
    if (this.failed) return Promise.reject(new Error("LIVE_VOICE_CONNECTION_FAILED"));
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }
  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }
  close(): void {
    this.socket.close();
  }
  private fail(code = "LIVE_VOICE_CONNECTION_FAILED"): void {
    this.failed = true;
    this.waiter?.reject(new Error(code));
    this.waiter = undefined;
  }
}

test("FR-C1 a real single-use token authenticates the native raw Scribe WebSocket", async () => {
  const token = await createVoiceToken(
    VoiceTokenRequestSchema.parse({}),
    voiceConfiguration(process.env),
  );
  const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
  url.search = new URLSearchParams({
    token: token.token,
    model_id: "scribe_v2_realtime",
    audio_format: "pcm_24000",
    commit_strategy: "manual",
  }).toString();
  const socket = new LiveSocket(url);
  const deadline = setTimeout(() => socket.close(), 10_000);
  try {
    await socket.open();
    expect((await socket.next()).message_type).toBe("session_started");
  } finally {
    clearTimeout(deadline);
    socket.close();
  }
});

test("FR-C1/FR-C4 real single-use tokens support two TTS sentences on one socket and raw Scribe transcription", async () => {
  const config = voiceConfiguration(process.env);
  const credential = await createVoiceToken(
    VoiceTokenRequestSchema.parse({ type: "tts_websocket" }),
    config,
  );
  if (!credential.voiceId || !credential.modelId)
    throw new Error("LIVE_VOICE_CONFIGURATION_REQUIRED");
  const url = new URL(
    `wss://api.elevenlabs.io/v1/text-to-speech/${credential.voiceId}/multi-stream-input`,
  );
  url.search = new URLSearchParams({
    single_use_token: credential.token,
    model_id: credential.modelId,
    output_format: "pcm_24000",
  }).toString();
  const tts = new LiveSocket(url);
  const deadline = setTimeout(() => tts.close(), 30_000);
  const audio: Buffer[] = [];
  try {
    await tts.open();
    for (const context of ["first", "second"]) {
      tts.send({
        text: " ",
        context_id: context,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      });
      tts.send({ text: "Bitte öffnen Sie den Arbeitsbereich. ", context_id: context });
      tts.send({ context_id: context, flush: true });
      let chunks = 0;
      for (;;) {
        const event = await tts.next();
        if (event.audio) {
          audio.push(Buffer.from(event.audio, "base64"));
          chunks += 1;
        }
        if (event.contextId && event.contextId !== context) continue;
        if (event.isFinal) break;
      }
      expect(chunks).toBeGreaterThan(0);
      tts.send({ context_id: context, close_context: true });
    }
  } finally {
    clearTimeout(deadline);
    tts.close();
  }
  const token = await createVoiceToken(VoiceTokenRequestSchema.parse({}), config);
  const scribeUrl = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
  scribeUrl.search = new URLSearchParams({
    token: token.token,
    model_id: "scribe_v2_realtime",
    audio_format: "pcm_24000",
    language_code: "de",
    commit_strategy: "manual",
  }).toString();
  const scribe = new LiveSocket(scribeUrl);
  const scribeDeadline = setTimeout(() => scribe.close(), 30_000);
  try {
    await scribe.open();
    expect((await scribe.next()).message_type).toBe("session_started");
    for (const chunk of audio)
      scribe.send({
        message_type: "input_audio_chunk",
        audio_base_64: chunk.toString("base64"),
        commit: false,
        sample_rate: 24000,
      });
    scribe.send({
      message_type: "input_audio_chunk",
      audio_base_64: "",
      commit: true,
      sample_rate: 24000,
    });
    for (;;) {
      const event = await scribe.next();
      if (event.message_type === "committed_transcript") {
        expect((event.text ?? "").length).toBeGreaterThan(0);
        break;
      }
    }
  } finally {
    clearTimeout(scribeDeadline);
    scribe.close();
  }
}, 90_000);
