import { voiceVocabulary } from "@lotse/knowledge/voice-vocabulary";
import type { SpeechSegment } from "@lotse/protocol";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const tokens = vi.hoisted(() => vi.fn());
vi.mock("../src/voice/token.ts", () => ({ fetchVoiceToken: tokens }));

import { BrowserSpeech } from "../src/voice/synthesis.ts";

// Isolated transport and audio doubles.
class Socket extends EventTarget {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  constructor(readonly url: URL) {
    super();
    Socket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }
  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  audio(id: string, final: boolean | null = null): void {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ contextId: id, audio: btoa("\0\0\0\0"), isFinal: final }),
      }),
    );
  }
}

class Source {
  buffer: unknown;
  playbackRate = { value: 1 };
  onended: (() => void) | undefined;
  connect(): void {}
  disconnect(): void {}
  start = vi.fn();
  stop = vi.fn(() => this.onended?.());
}

class Context {
  static sources: Source[] = [];
  get currentTime(): number {
    return Date.now() / 1000;
  }
  destination = {};
  resume = async () => undefined;
  close = async () => undefined;
  createBuffer(_channels: number, samples: number, rate: number) {
    return { duration: samples / rate, getChannelData: () => new Float32Array(samples) };
  }
  createBufferSource(): Source {
    const source = new Source();
    Context.sources.push(source);
    return source;
  }
}

const segment: SpeechSegment = {
  turnId: "test-turn",
  index: 0,
  text: "Where is the form?",
  language: "en",
  citations: [],
  actionIds: ["test-action"],
};

const callbacks = { start: vi.fn(), speaking: vi.fn(), fallback: vi.fn(), complete: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.resetAllMocks();
  Socket.instances = [];
  Context.sources = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("AudioContext", Context);
  tokens.mockResolvedValue({
    token: "single-use-token",
    voiceId: "test-voice",
    vocabulary: voiceVocabulary("en"),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("FR-C4 reuses a token and socket for sentence contexts and fires actions at playback start", async () => {
  const speech = new BrowserSpeech(callbacks);
  speech.enqueue(segment);
  await vi.advanceTimersByTimeAsync(0);
  const socket = Socket.instances[0];
  expect(socket?.sent).toContainEqual({
    context_id: "test-turn-0",
    text: "Where is the form? ",
    flush: true,
  });
  socket?.audio("test-turn-0", null);
  socket?.audio("test-turn-0", true);
  expect(callbacks.start).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30);
  expect(callbacks.start).toHaveBeenCalledExactlyOnceWith(segment);
  speech.enqueue({ ...segment, index: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(Socket.instances).toHaveLength(1);
  expect(tokens).toHaveBeenCalledTimes(1);
  expect(socket?.sent).toContainEqual({ context_id: "test-turn-1", close_context: true });
  speech.stop();
});

test("barge-in stops scheduled audio, closes the socket and cancels sentence actions", async () => {
  const speech = new BrowserSpeech(callbacks);
  speech.enqueue(segment);
  await vi.advanceTimersByTimeAsync(0);
  Socket.instances[0]?.audio("test-turn-0", true);
  speech.stop();
  await vi.advanceTimersByTimeAsync(100);
  expect(Context.sources[0]?.stop).toHaveBeenCalledTimes(1);
  expect(Socket.instances[0]?.readyState).toBe(3);
  expect(callbacks.start).not.toHaveBeenCalled();
});

test("provider outage uses Web Speech at the selected language and speed, with start-aligned actions", async () => {
  tokens.mockRejectedValue(new Error("provider unavailable"));
  class Utterance {
    lang = "";
    rate = 1;
    onstart: (() => void) | undefined;
    onend: (() => void) | undefined;
    constructor(readonly text: string) {}
  }
  let utterance: Utterance | undefined;
  const cancel = vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    speak: (value: Utterance) => {
      utterance = value;
    },
    cancel,
  });
  const speech = new BrowserSpeech(callbacks);
  speech.speed = 0.5;
  speech.enqueue(segment);
  await vi.advanceTimersByTimeAsync(0);
  expect(utterance).toMatchObject({ text: segment.text, lang: "en", rate: 0.5 });
  expect(callbacks.start).not.toHaveBeenCalled();
  utterance?.onstart?.();
  expect(callbacks.start).toHaveBeenCalledExactlyOnceWith(segment);
  expect(callbacks.complete).not.toHaveBeenCalled();
  utterance?.onend?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(callbacks.complete).toHaveBeenCalledTimes(1);
  speech.stop();
  expect(callbacks.complete).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalled();
});

test("FR-C4 applies the token pronunciation lexicon to synthesized text and keeps captions unchanged", async () => {
  const vocabulary = voiceVocabulary("de");
  tokens.mockResolvedValue({
    token: "single-use-token",
    voiceId: "test-voice",
    modelId: "configured-model",
    vocabulary,
  });
  const sentence = { ...segment, language: "de", text: "ÖGK, SVS, BVAEB und PVA." };
  const speech = new BrowserSpeech(callbacks);
  speech.enqueue(sentence);
  await vi.advanceTimersByTimeAsync(0);
  const socket = Socket.instances[0];
  expect(socket?.url.searchParams.get("model_id")).toBe("configured-model");
  expect(socket?.sent).toContainEqual({
    context_id: "test-turn-0",
    text: "Ö Geh Kah, Es Fau Es, Be Fau A E Be und Pe Fau A. ",
    flush: true,
  });
  socket?.audio("test-turn-0", true);
  await vi.advanceTimersByTimeAsync(30);
  expect(callbacks.start).toHaveBeenCalledExactlyOnceWith(sentence);
  expect(sentence.text).toBe("ÖGK, SVS, BVAEB und PVA.");
  speech.stop();
});
