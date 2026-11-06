import { applyVoiceAliases, type VoiceAlias } from "@lotse/knowledge/voice-vocabulary";
import type { SpeechSegment } from "@lotse/protocol";
import { z } from "zod";
import { applySpeechPreferences } from "../features/settings/speech-preferences.ts";
import { voiceConfig } from "./config.ts";
import { fetchVoiceToken } from "./token.ts";

// The live service uses camelCase; the published API reference also documents snake_case.
const AudioMessageSchema = z.union([
  z
    .object({
      contextId: z.string(),
      audio: z.string().nullable().optional(),
      isFinal: z.boolean().nullable().optional(),
    })
    .transform((data) => ({
      context_id: data.contextId,
      audio: data.audio,
      is_final: data.isFinal,
    })),
  z.object({
    context_id: z.string(),
    audio: z.string().nullable().optional(),
    is_final: z.boolean().nullable().optional(),
  }),
]);

class TurnSocket {
  private pronunciationAliases: VoiceAlias[] = [];
  private socket: WebSocket | undefined;
  private ready: Promise<WebSocket> | undefined;
  constructor(private readonly signal: AbortSignal) {}

  private connect(segment: SpeechSegment): Promise<WebSocket> {
    if (this.socket && this.socket.readyState > WebSocket.OPEN) this.ready = undefined;
    this.ready ??= (async () => {
      const language = segment.language.startsWith("en") ? "en" : "de";
      const { token, voiceId, modelId, vocabulary } = await fetchVoiceToken(
        { type: "tts_websocket", language },
        this.signal,
      );
      if (!voiceId || this.signal.aborted) throw new Error("VOICE_UNAVAILABLE");
      const url = new URL(
        `${voiceConfig.ttsSocket}${encodeURIComponent(voiceId)}/multi-stream-input`,
      );
      url.searchParams.set("single_use_token", token);
      url.searchParams.set("model_id", modelId ?? voiceConfig.ttsModel);
      this.pronunciationAliases = vocabulary.pronunciationAliases;
      url.searchParams.set("output_format", voiceConfig.outputFormat);
      const socket = new WebSocket(url);
      this.socket = socket;
      return new Promise<WebSocket>((resolve, reject) => {
        const fail = () => {
          cleanup();
          reject(new Error("VOICE_UNAVAILABLE"));
        };
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeEventListener("error", fail);
          socket.removeEventListener("close", fail);
          this.signal.removeEventListener("abort", fail);
        };
        const timer = setTimeout(fail, voiceConfig.providerTimeoutMs);
        socket.addEventListener("error", fail);
        socket.addEventListener("close", fail);
        this.signal.addEventListener("abort", fail, { once: true });
        socket.addEventListener(
          "open",
          () => {
            cleanup();
            resolve(socket);
          },
          { once: true },
        );
      });
    })();
    return this.ready;
  }

  async speak(segment: SpeechSegment, audio: (data: string) => void): Promise<void> {
    const socket = await this.connect(segment);
    if (this.signal.aborted) throw new Error("VOICE_CANCELLED");
    const id = `${segment.turnId}-${segment.index}`;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("message", message);
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
        this.signal.removeEventListener("abort", fail);
      };
      const fail = () => {
        cleanup();
        reject(new Error("VOICE_UNAVAILABLE"));
      };
      const message = (event: MessageEvent<unknown>) => {
        try {
          if (typeof event.data !== "string") {
            fail();
            return;
          }
          const data = AudioMessageSchema.parse(JSON.parse(event.data));
          if (data.context_id !== id) return;
          clearTimeout(timer);
          timer = setTimeout(fail, voiceConfig.providerTimeoutMs);
          if (data.audio) audio(data.audio);
          if (data.is_final) {
            cleanup();
            resolve();
          }
        } catch {
          fail();
        }
      };
      let timer = setTimeout(fail, voiceConfig.providerTimeoutMs);
      socket.addEventListener("message", message);
      socket.addEventListener("error", fail);
      socket.addEventListener("close", fail);
      this.signal.addEventListener("abort", fail, { once: true });
      socket.send(JSON.stringify({ context_id: id, text: " " }));
      socket.send(
        JSON.stringify({
          context_id: id,
          text: `${applyVoiceAliases(segment.text, this.pronunciationAliases)} `,
          flush: true,
        }),
      );
      socket.send(JSON.stringify({ context_id: id, close_context: true }));
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}

export type SpeechCallbacks = {
  start: (segment: SpeechSegment) => void;
  speaking: (speaking: boolean) => void;
  fallback: () => void;
  complete?: () => void;
};

export class BrowserSpeech {
  private context: AudioContext | undefined;
  private controller = new AbortController();
  private socket = new TurnSocket(this.controller.signal);
  private turnId: string | undefined;
  private queue: SpeechSegment[] = [];
  private running = false;
  private native = false;
  private scheduledUntil = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private started = new Set<string>();
  private drain: Promise<void> = Promise.resolve();
  speed: number = voiceConfig.defaultSpeed;
  voiceURI = "";

  constructor(private readonly callbacks: SpeechCallbacks) {}

  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => undefined);
    } catch {
      this.callbacks.fallback();
    }
  }

  enqueue(segment: SpeechSegment): void {
    if (segment.turnId !== this.turnId) {
      this.stop();
      this.turnId = segment.turnId;
    }
    this.queue.push(segment);
    if (!this.running) void this.run(this.controller);
  }

  stop(): void {
    this.controller.abort();
    this.socket.close();
    this.controller = new AbortController();
    this.socket = new TurnSocket(this.controller.signal);
    this.queue = [];
    this.running = false;
    this.native = false;
    this.turnId = undefined;
    this.started.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.scheduledUntil = 0;
    this.drain = Promise.resolve();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.callbacks.speaking(false);
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = undefined;
  }

  private start(segment: SpeechSegment): void {
    const key = `${segment.turnId}-${segment.index}`;
    if (this.started.has(key)) return;
    this.started.add(key);
    this.callbacks.start(segment);
    this.callbacks.speaking(true);
  }

  private schedule(data: string, segment: SpeechSegment, controller: AbortController): void {
    this.unlock();
    const context = this.context;
    if (controller.signal.aborted) return;
    if (!context) throw new Error("AUDIO_UNAVAILABLE");
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    if (bytes.length % 2 !== 0) throw new Error("INVALID_AUDIO");
    const buffer = context.createBuffer(1, bytes.length / 2, voiceConfig.sampleRate);
    const samples = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.min(
      voiceConfig.maxSpeed,
      Math.max(voiceConfig.minSpeed, this.speed),
    );
    source.connect(context.destination);
    const at = Math.max(context.currentTime + voiceConfig.playbackLeadSeconds, this.scheduledUntil);
    this.scheduledUntil = at + buffer.duration / source.playbackRate.value;
    this.sources.add(source);
    this.drain = new Promise<void>((resolve) => {
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
        resolve();
      };
    });
    this.announceAt(at, segment, context, controller);
    source.start(at);
  }

  private announceAt(
    at: number,
    segment: SpeechSegment,
    context: AudioContext,
    controller: AbortController,
  ): void {
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        if (controller.signal.aborted) return;
        if (context.currentTime < at || context.state === "suspended") {
          this.announceAt(at, segment, context, controller);
          return;
        }
        this.start(segment);
      },
      Math.max(voiceConfig.playbackLeadSeconds, at - context.currentTime) * 1000,
    );
    this.timers.add(timer);
  }

  private async nativeSpeak(segment: SpeechSegment, controller: AbortController): Promise<void> {
    if (typeof speechSynthesis === "undefined" || controller.signal.aborted) {
      if (!controller.signal.aborted) this.callbacks.start(segment);
      return;
    }
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(segment.text);
      utterance.lang = segment.language;
      applySpeechPreferences(
        utterance,
        { speechRate: this.speed, voiceURI: this.voiceURI },
        speechSynthesis.getVoices?.() ?? [],
      );
      utterance.onstart = () => {
        if (!controller.signal.aborted) this.start(segment);
      };
      const done = () => {
        controller.signal.removeEventListener("abort", done);
        resolve();
      };
      utterance.onend = done;
      utterance.onerror = done;
      controller.signal.addEventListener("abort", done, { once: true });
      speechSynthesis.speak(utterance);
    });
  }

  private async run(controller: AbortController): Promise<void> {
    this.running = true;
    while (this.queue.length > 0 && !controller.signal.aborted) {
      const segment = this.queue.shift();
      if (!segment) break;
      if (!this.native) {
        try {
          await this.socket.speak(segment, (audio) => this.schedule(audio, segment, controller));
          continue;
        } catch {
          if (controller.signal.aborted) return;
          this.socket.close();
          this.native = true;
          this.callbacks.fallback();
          await this.drain;
        }
      }
      await this.nativeSpeak(segment, controller);
    }
    if (controller.signal.aborted) return;
    this.running = false;
    const drain = this.drain;
    await drain;
    if (!controller.signal.aborted && !this.running && drain === this.drain) {
      this.callbacks.speaking(false);
      this.callbacks.complete?.();
    }
  }
}
