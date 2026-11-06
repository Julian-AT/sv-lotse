import { voiceVocabulary } from "@lotse/knowledge/voice-vocabulary";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  handlers: new Map<string, (data?: unknown) => void>(),
  commit: vi.fn(),
  mute: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  token: vi.fn(),
}));
vi.mock("@elevenlabs/client", () => ({
  Scribe: { connect: sdk.connect },
  CommitStrategy: { MANUAL: "manual" },
  RealtimeEvents: {
    AUDIO_STARTED: "audio",
    PARTIAL_TRANSCRIPT: "partial",
    COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS: "final",
    ERROR: "error",
    CLOSE: "close",
  },
}));
vi.mock("../src/voice/token.ts", () => ({ fetchVoiceToken: sdk.token }));

import { BrowserRecognition } from "../src/voice/recognition.ts";

const callbacks = { state: vi.fn(), partial: vi.fn(), final: vi.fn(), fallback: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  sdk.handlers.clear();
  sdk.token.mockResolvedValue({ token: "test-token", vocabulary: voiceVocabulary("de") });
  sdk.connect.mockReturnValue({
    on: (event: string, handler: (data?: unknown) => void) => sdk.handlers.set(event, handler),
    close: sdk.close,
    commit: sdk.commit,
    mute: sdk.mute,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("FR-L1 sends one committed message on release, preserves detected language, and releases microphone", async () => {
  const recognition = new BrowserRecognition(callbacks);
  await recognition.start("de");
  sdk.handlers.get("audio")?.();
  sdk.handlers.get("partial")?.({ text: "Where is the form?" });
  expect(callbacks.final).not.toHaveBeenCalled();
  recognition.release();
  recognition.release();
  expect(sdk.mute).toHaveBeenCalledTimes(1);
  expect(sdk.commit).toHaveBeenCalledTimes(1);
  sdk.handlers.get("final")?.({ text: "Where is the form?", language_code: "en" });
  expect(callbacks.final).toHaveBeenCalledExactlyOnceWith("Where is the form?", "en");
  expect(sdk.close).toHaveBeenCalledTimes(1);
  await vi.runAllTimersAsync();
  expect(callbacks.state).not.toHaveBeenCalledWith("error");
});

test("release while token minting is pending never opens a microphone or sends a message", async () => {
  let finish: ((value: { token: string }) => void) | undefined;
  sdk.token.mockReturnValue(
    new Promise<{ token: string }>((resolve) => {
      finish = resolve;
    }),
  );
  const recognition = new BrowserRecognition(callbacks);
  const start = recognition.start("en");
  recognition.release();
  finish?.({ token: "test-token" });
  await start;
  expect(sdk.connect).not.toHaveBeenCalled();
  expect(callbacks.final).not.toHaveBeenCalled();
});

test("cancelled capture ignores late provider transcripts", async () => {
  const recognition = new BrowserRecognition(callbacks);
  await recognition.start("de");
  recognition.cancel();
  sdk.handlers.get("final")?.({ text: "Late text", language_code: "de" });
  expect(callbacks.final).not.toHaveBeenCalled();
});

test("provider outage uses Web Speech and sends only after key release", async () => {
  class NativeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult:
      | ((event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void)
      | undefined;
    onend: (() => void) | undefined;
    start() {
      this.onresult?.({ results: [{ isFinal: true, 0: { transcript: "Where is the form?" } }] });
    }
    stop() {
      this.onend?.();
    }
    abort() {}
  }
  vi.stubGlobal("window", { SpeechRecognition: NativeRecognition });
  sdk.token.mockRejectedValue(new Error("unavailable"));
  const recognition = new BrowserRecognition(callbacks);
  await recognition.start("en");
  expect(callbacks.fallback).toHaveBeenCalledTimes(1);
  expect(callbacks.final).not.toHaveBeenCalled();
  recognition.release();
  expect(callbacks.final).toHaveBeenCalledExactlyOnceWith("Where is the form?", "en");
  recognition.cancel();
});

test.each(["de", "en"] as const)(
  "FR-C1 pins Scribe to profile language %s and passes catalog keyterms",
  async (language) => {
    sdk.token.mockResolvedValue({ token: "test-token", vocabulary: voiceVocabulary(language) });
    const recognition = new BrowserRecognition(callbacks);
    await recognition.start(language);
    expect(sdk.token).toHaveBeenCalledWith(
      { type: "realtime_scribe", language },
      expect.any(AbortSignal),
    );
    expect(sdk.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        languageCode: language,
        keyterms: voiceVocabulary(language).keyterms,
      }),
    );
    recognition.cancel();
  },
);

test("FR-C1 normalizes committed domain spellings without rewriting the partial transcript", async () => {
  const recognition = new BrowserRecognition(callbacks);
  await recognition.start("de");
  sdk.handlers.get("audio")?.();
  sdk.handlers.get("partial")?.({ text: "OEGK und pflegegeld" });
  expect(callbacks.partial).toHaveBeenLastCalledWith("OEGK und pflegegeld");
  recognition.release();
  sdk.handlers.get("final")?.({ text: "OEGK und pflegegeld", language_code: "de" });
  expect(callbacks.final).toHaveBeenCalledExactlyOnceWith("ÖGK und Pflegegeld", "de");
});
