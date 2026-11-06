"use client";

import {
  type Action,
  ActionSchema,
  type SpeechSegment,
  SpeechSegmentSchema,
} from "@lotse/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechPreferences } from "../features/settings/speech-preferences.ts";
import { voiceConfig } from "./config.ts";
import type { VoiceLanguage } from "./copy.ts";
import { BrowserRecognition, type RecordingState } from "./recognition.ts";
import { BrowserSpeech } from "./synthesis.ts";

type VoiceOptions = {
  language: VoiceLanguage;
  onTranscript: (text: string, language?: string) => void;
  onAction: (action: Action) => void;
  onInterrupt: () => void;
};

export type BrowserVoice = {
  recording: RecordingState;
  partial: string;
  caption: string;
  speaking: boolean;
  fallback: boolean;
  enabled: boolean;
  speed: number;
  start: () => void;
  release: () => void;
  cancel: () => void;
  stop: () => void;
  receive: (part: { type: string; data: unknown }) => void;
  setEnabled: (enabled: boolean) => void;
  setSpeed: (speed: number) => void;
  unlock: () => void;
  beginTurn: () => void;
};

export function useBrowserVoice(options: VoiceOptions): BrowserVoice {
  const preferences = useSpeechPreferences();
  const latest = useRef(options);
  latest.current = options;
  const [recording, setRecording] = useState<RecordingState>("idle");
  const [partial, setPartial] = useState("");
  const [caption, setCaption] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [speed, setSpeed] = useState<number>(voiceConfig.defaultSpeed);
  const speech = useRef<BrowserSpeech | undefined>(undefined);
  const recognition = useRef<BrowserRecognition | undefined>(undefined);
  const actions = useRef(new Map<string, Action>());
  const requested = useRef(new Set<string>());
  const fired = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const mutedTurn = useRef<string | undefined>(undefined);
  const currentTurn = useRef<string | undefined>(undefined);
  const interrupted = useRef(false);

  const fire = useCallback((action: Action): void => {
    if (fired.current.has(action.id)) return;
    fired.current.add(action.id);
    latest.current.onAction(action);
  }, []);

  const sentenceStart = useCallback(
    (segment: SpeechSegment): void => {
      setCaption(segment.text);
      for (const id of segment.actionIds) {
        requested.current.add(id);
        const action = actions.current.get(id);
        if (action) fire(action);
      }
    },
    [fire],
  );

  useEffect(() => {
    speech.current = new BrowserSpeech({
      start: sentenceStart,
      speaking: setSpeaking,
      fallback: () => setFallback(true),
    });
    recognition.current = new BrowserRecognition({
      state: setRecording,
      partial: setPartial,
      final: (text, language) => {
        setPartial("");
        latest.current.onTranscript(text, language);
      },
      fallback: () => setFallback(true),
    });
    return () => {
      recognition.current?.cancel();
      speech.current?.dispose();
    };
  }, [sentenceStart]);

  useEffect(() => {
    setSpeed(preferences.speechRate);
    if (speech.current) {
      speech.current.speed = preferences.speechRate;
      speech.current.voiceURI = preferences.voiceURI;
    }
  }, [preferences]);

  function stop(): void {
    interrupted.current = true;
    mutedTurn.current = currentTurn.current;
    requested.current.clear();
    speech.current?.stop();
  }

  function start(): void {
    if (recording === "processing") return;
    stop();
    latest.current.onInterrupt();
    speech.current?.unlock();
    setFallback(false);
    void recognition.current?.start(latest.current.language);
  }

  function receive(part: { type: string; data: unknown }): void {
    if (interrupted.current) return;
    if (part.type === "data-action") {
      const parsed = ActionSchema.safeParse(part.data);
      if (!parsed.success) return;
      actions.current.set(parsed.data.id, parsed.data);
      if (requested.current.has(parsed.data.id)) fire(parsed.data);
    }
    if (part.type !== "data-speech-segment") return;
    const parsed = SpeechSegmentSchema.safeParse(part.data);
    if (!parsed.success) return;
    const segment = parsed.data;
    const key = `${segment.turnId}-${segment.index}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    currentTurn.current = segment.turnId;
    if (mutedTurn.current === segment.turnId) return;
    if (!enabled) {
      sentenceStart(segment);
      return;
    }
    if (speech.current) speech.current.speed = speed;
    speech.current?.enqueue(segment);
  }

  return {
    recording,
    partial,
    caption,
    speaking,
    fallback,
    enabled,
    speed,
    start,
    release: () => recognition.current?.release(),
    cancel: () => recognition.current?.cancel(),
    stop,
    receive,
    setEnabled: (value: boolean) => {
      setEnabled(value);
      if (!value) stop();
    },
    setSpeed: (value: number) => {
      const bounded = Math.min(voiceConfig.maxSpeed, Math.max(voiceConfig.minSpeed, value));
      setSpeed(bounded);
      if (speech.current) speech.current.speed = bounded;
    },
    unlock: () => speech.current?.unlock(),
    beginTurn: () => {
      interrupted.current = false;
      mutedTurn.current = undefined;
      actions.current.clear();
      requested.current.clear();
      fired.current.clear();
    },
  };
}
