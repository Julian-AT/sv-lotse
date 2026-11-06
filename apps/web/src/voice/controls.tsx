"use client";

import { type ReactElement, useId } from "react";
import { voiceConfig } from "./config.ts";
import { type VoiceLanguage, voiceCopy } from "./copy.ts";
import type { BrowserVoice } from "./use-browser-voice.ts";
import styles from "./voice.module.css";

export function VoiceControls({
  voice,
  language,
}: {
  voice: BrowserVoice;
  language: VoiceLanguage;
}): ReactElement {
  const copy = voiceCopy[language];
  const helpId = useId();
  const speedId = useId();
  const busy = voice.recording === "processing";
  const state = voice.recording;
  const label = state === "idle" || state === "error" ? copy.hold : copy[state];
  return (
    <section className={styles.voice} aria-label={copy.title}>
      <p id={helpId}>{copy.permission}</p>
      <div className={styles.buttons}>
        <button
          type="button"
          aria-describedby={helpId}
          aria-pressed={state === "listening"}
          aria-disabled={busy}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            voice.start();
          }}
          onPointerUp={voice.release}
          onPointerCancel={voice.cancel}
          onLostPointerCapture={voice.release}
          onBlur={voice.cancel}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              voice.start();
            }
            if (event.key === "Escape") voice.cancel();
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              voice.release();
            }
          }}
          className={styles.pushToTalk}
        >
          {label}
        </button>
        <button type="button" onClick={voice.stop}>
          {copy.stop}
        </button>
      </div>
      <label>
        <input
          type="checkbox"
          checked={voice.enabled}
          onChange={(event) => voice.setEnabled(event.target.checked)}
        />
        {copy.enabled}
      </label>
      <label htmlFor={speedId}>
        {copy.speed} ({voice.speed.toFixed(1)}×)
      </label>
      <input
        id={speedId}
        type="range"
        min={voiceConfig.minSpeed}
        max={voiceConfig.maxSpeed}
        step={voiceConfig.speedStep}
        value={voice.speed}
        onChange={(event) => voice.setSpeed(Number(event.target.value))}
      />
      {state === "error" || voice.fallback ? (
        <p role="status">{state === "error" ? copy.error : copy.fallback}</p>
      ) : null}
      <p aria-live="polite">{voice.partial}</p>
      <p className={styles.caption} aria-live="polite">
        {voice.caption}
      </p>
    </section>
  );
}
