import { applyVoiceAliases, voiceVocabulary } from "@lotse/knowledge/voice-vocabulary";
import { voiceConfig } from "./config.ts";
import type { VoiceLanguage } from "./copy.ts";
import { fetchVoiceToken } from "./token.ts";

export type RecordingState = "idle" | "connecting" | "listening" | "processing" | "error";
export type RecognitionCallbacks = {
  state: (state: RecordingState) => void;
  partial: (text: string) => void;
  final: (text: string, language?: string) => void;
  fallback: () => void;
};

type NativeRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionWindow = Window & {
  SpeechRecognition?: new () => NativeRecognition;
  webkitSpeechRecognition?: new () => NativeRecognition;
};

export class BrowserRecognition {
  private controller: AbortController | undefined;
  private close: (() => void) | undefined;
  private commit: (() => void) | undefined;
  private held = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly callbacks: RecognitionCallbacks) {}

  async start(language: VoiceLanguage): Promise<void> {
    if (this.held) return;
    this.cancel();
    this.held = true;
    this.callbacks.partial("");
    this.callbacks.state("connecting");
    const controller = new AbortController();
    this.controller = controller;
    this.timer = setTimeout(() => this.fail(controller, language), voiceConfig.providerTimeoutMs);
    try {
      const [{ Scribe, CommitStrategy, RealtimeEvents }, { token, vocabulary }] = await Promise.all(
        [
          import("@elevenlabs/client"),
          fetchVoiceToken({ type: "realtime_scribe", language }, controller.signal),
        ],
      );
      if (controller.signal.aborted) return;
      const connection = Scribe.connect({
        token,
        modelId: voiceConfig.scribeModel,
        languageCode: language,
        keyterms: vocabulary.keyterms,
        commitStrategy: CommitStrategy.MANUAL,
        includeTimestamps: true,
        includeLanguageDetection: true,
        microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.close = () => connection.close();
      const committed: string[] = [];
      let detected: string | undefined;
      connection.on(RealtimeEvents.AUDIO_STARTED, () => {
        if (controller.signal.aborted) return;
        clearTimeout(this.timer);
        this.callbacks.state("listening");
        this.commit = () => {
          // Muting prevents speech after key release from entering the next segment.
          connection.mute();
          connection.commit();
        };
      });
      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
        if (!controller.signal.aborted) this.callbacks.partial([...committed, data.text].join(" "));
      });
      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (data) => {
        if (controller.signal.aborted) return;
        if (data.text.trim()) committed.push(data.text.trim());
        detected = data.language_code ?? detected;
        if (this.held) {
          this.callbacks.partial(committed.join(" "));
          return;
        }
        const text = committed.join(" ");
        this.cancel();
        if (text)
          this.callbacks.final(applyVoiceAliases(text, vocabulary.spellingAliases), detected);
      });
      connection.on(RealtimeEvents.ERROR, () => this.fail(controller, language));
      connection.on(RealtimeEvents.CLOSE, () => this.fail(controller, language));
    } catch {
      this.fail(controller, language);
    }
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    if (!this.commit) {
      this.cancel();
      return;
    }
    this.callbacks.state("processing");
    try {
      this.timer = setTimeout(() => {
        this.cancel();
        this.callbacks.state("error");
      }, voiceConfig.transcriptTimeoutMs);
      this.commit();
    } catch {
      this.cancel();
      this.callbacks.state("error");
    }
  }

  cancel(): void {
    this.held = false;
    this.controller?.abort();
    this.controller = undefined;
    clearTimeout(this.timer);
    const close = this.close;
    this.close = undefined;
    this.commit = undefined;
    close?.();
    this.callbacks.state("idle");
  }

  private fail(controller: AbortController, language: VoiceLanguage): void {
    if (controller.signal.aborted) return;
    const held = this.held;
    this.cancel();
    if (held) this.startNative(language);
    else this.callbacks.state("error");
  }

  private startNative(language: VoiceLanguage): void {
    const host = window as RecognitionWindow;
    const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Constructor) {
      this.callbacks.state("error");
      return;
    }
    const recognition = new Constructor();
    let text = "";
    let active = true;
    this.held = true;
    recognition.lang = language === "de" ? "de-AT" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      text = Array.from(event.results, (result) => result[0].transcript)
        .join(" ")
        .trim();
      this.callbacks.partial(text);
    };
    recognition.onend = () => {
      if (!active) return;
      active = false;
      const released = !this.held;
      this.cancel();
      if (released && text)
        this.callbacks.final(
          applyVoiceAliases(text, voiceVocabulary(language).spellingAliases),
          language,
        );
    };
    recognition.onerror = () => {
      this.cancel();
      this.callbacks.state("error");
    };
    this.close = () => {
      active = false;
      recognition.abort();
    };
    this.commit = () => recognition.stop();
    this.callbacks.fallback();
    try {
      recognition.start();
      this.callbacks.state("listening");
    } catch {
      this.cancel();
      this.callbacks.state("error");
    }
  }
}
