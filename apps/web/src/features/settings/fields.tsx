"use client";

import {
  type Preferences,
  preferencesPatchSchema,
  preferencesSchema,
} from "@lotse/brain/preferences/schema";
import { type JSX, useEffect, useId, useState } from "react";
import styles from "../shell/shell.module.css";
import type { SettingsCopy } from "./copy.ts";
import panelStyles from "./settings.module.css";

export type FieldsSection =
  | "all"
  | "language"
  | "accessibility"
  | "control"
  | "profile"
  | "voice"
  | "assistant"
  | "privacy";
type Props = {
  value: Preferences;
  onChange: (next: Preferences) => void;
  copy: SettingsCopy;
  section?: FieldsSection;
  autonomyHelp?: string;
};
export function PreferenceFields({
  value,
  onChange,
  copy,
  section = "all",
  autonomyHelp,
}: Props): JSX.Element {
  const id = useId();
  function update(name: keyof Preferences, next: unknown): void {
    onChange(
      preferencesSchema.parse({
        ...value,
        ...preferencesPatchSchema.parse({ [name]: next }),
        ...(name === "language" ? { voiceURI: "" } : {}),
      }),
    );
  }
  function select(
    name: keyof Preferences,
    label: string,
    options: readonly (readonly [string, string])[],
  ): JSX.Element {
    return (
      <div className={styles.field} key={name}>
        <label htmlFor={`${id}-${name}`}>{label}</label>
        <select
          id={`${id}-${name}`}
          value={String(value[name])}
          onChange={(event) => update(name, event.target.value)}
        >
          {options.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </div>
    );
  }
  function check(
    name: "simpleLanguage" | "analyticsConsent" | "reducedMotion" | "highContrast",
    label: string,
    description?: string,
  ): JSX.Element {
    return (
      <label className={styles.choice} htmlFor={`${id}-${name}`}>
        <input
          id={`${id}-${name}`}
          type="checkbox"
          checked={value[name]}
          onChange={(event) => update(name, event.target.checked)}
          aria-describedby={description}
        />
        {label}
      </label>
    );
  }
  return (
    <>
      {(section === "all" || section === "language" || section === "profile") && (
        <fieldset className={styles.fields}>
          <legend className={section === "profile" ? panelStyles.visuallyHidden : undefined}>
            {copy.language}
          </legend>
          {select("language", copy.language, [
            ["de", copy.de],
            ["en", copy.en],
          ])}
          {check("simpleLanguage", copy.simpleLanguage)}
          {select("register", copy.register, [
            ["formal", copy.formal],
            ["informal", copy.informal],
          ])}
          {select("detailLevel", copy.detailLevel, [
            ["brief", copy.brief],
            ["standard", copy.standard],
            ["detailed", copy.detailed],
          ])}
          {section !== "profile" && <VoiceSample value={value} onChange={onChange} copy={copy} />}
        </fieldset>
      )}
      {section === "voice" && <VoiceSample value={value} onChange={onChange} copy={copy} />}
      {(section === "all" || section === "accessibility") && (
        <fieldset className={styles.fields}>
          <legend>{copy.accessibility}</legend>
          {check("reducedMotion", copy.reducedMotion)}
          {check("highContrast", copy.highContrast)}
          {(["cursorSize", "cursorSpeed"] as const).map((name) => (
            <div className={styles.field} key={name}>
              <label htmlFor={`${id}-${name}`}>{copy[name]}</label>
              <select
                id={`${id}-${name}`}
                value={value[name]}
                onChange={(event) => update(name, Number(event.target.value))}
              >
                {(name === "cursorSize"
                  ? [
                      [24, copy.cursorSizes[0]],
                      [40, copy.cursorSizes[1]],
                      [64, copy.cursorSizes[2]],
                    ]
                  : [
                      [0.5, copy.slow],
                      [1, copy.normal],
                      [1.5, copy.fast],
                    ]
                ).map(([number, label]) => (
                  <option key={number} value={number}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
      )}
      {(section === "all" || section === "control" || section === "assistant") && (
        <fieldset className={styles.fields}>
          <legend className={section === "assistant" ? panelStyles.visuallyHidden : undefined}>
            {copy.autonomyLevel}
          </legend>
          <div className={styles.field}>
            <label htmlFor={`${id}-autonomyLevel`}>{copy.autonomyLevel}</label>
            <select
              id={`${id}-autonomyLevel`}
              value={value.autonomyLevel}
              onChange={(event) => update("autonomyLevel", event.target.value)}
              aria-describedby={`${id}-autonomy-help`}
            >
              {(["L1", "L2", "L3"] as const).map((level) => (
                <option value={level} key={level}>
                  {copy[level]}
                </option>
              ))}
            </select>
          </div>
          <p
            id={`${id}-autonomy-help`}
            className={section === "assistant" ? panelStyles.levelExplanation : undefined}
          >
            {autonomyHelp ?? copy.autonomyHelp}
          </p>
          {section !== "assistant" && (
            <>
              {check("analyticsConsent", copy.analyticsConsent, `${id}-analytics-help`)}
              <p id={`${id}-analytics-help`}>{copy.analyticsHelp}</p>
            </>
          )}
        </fieldset>
      )}
      {section === "privacy" && (
        <div>
          {check("analyticsConsent", copy.analyticsConsent, `${id}-analytics-help`)}
          <p id={`${id}-analytics-help`}>{copy.analyticsHelp}</p>
        </div>
      )}
    </>
  );
}

function VoiceSample({ value, onChange, copy }: Props): JSX.Element {
  const id = useId();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    setAvailable(true);
    const refresh = (): void => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => {
      synth.removeEventListener("voiceschanged", refresh);
      synth.cancel();
    };
  }, []);
  function speak(): void {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(copy.sampleText);
    utterance.lang = value.language === "de" ? "de-AT" : "en";
    utterance.rate = value.speechRate;
    const voice = voices.find(
      (candidate) =>
        candidate.voiceURI === value.voiceURI && candidate.lang.startsWith(value.language),
    );
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  }
  return (
    <>
      <div className={styles.field}>
        <label htmlFor={`${id}-voice`}>{copy.voice}</label>
        <select
          id={`${id}-voice`}
          value={value.voiceURI}
          disabled={!available}
          onChange={(event) => onChange({ ...value, voiceURI: event.target.value })}
        >
          <option value="">{copy.systemVoice}</option>
          {voices
            .filter((voice) => voice.lang.startsWith(value.language))
            .map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name}
              </option>
            ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-rate`}>{copy.speechRate}</label>
        <select
          id={`${id}-rate`}
          value={value.speechRate}
          onChange={(event) => onChange({ ...value, speechRate: Number(event.target.value) })}
        >
          <option value={0.5}>{copy.slow}</option>
          <option value={1}>{copy.normal}</option>
          <option value={1.5}>{copy.fast}</option>
        </select>
      </div>
      <p>{copy.sampleText}</p>
      {available ? (
        <button type="button" onClick={speak}>
          {copy.sample}
        </button>
      ) : (
        <p>{copy.voiceUnavailable}</p>
      )}
    </>
  );
}
