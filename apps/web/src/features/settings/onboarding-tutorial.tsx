"use client";

import type { Preferences } from "@lotse/brain/preferences/schema";
import { createGuide, type Guide, readCursorPreferences } from "@lotse/guide";
import letter from "@lotse/knowledge/demo/onboarding-letter";
import { type JSX, useEffect, useId, useRef, useState } from "react";
import { ONBOARDING_CONFIG } from "@/config.ts";
import { typeFieldValue } from "../form-viewer/typing.ts";
import styles from "./tutorial.module.css";
import { tutorialCopy } from "./tutorial-copy.ts";

export function OnboardingTutorial({ preferences }: { preferences: Preferences }): JSX.Element {
  const copy = tutorialCopy[preferences.language];
  const id = useId();
  const [stage, setStage] = useState(0);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const guide = useRef<Guide | null>(null);
  const aborter = useRef<AbortController | null>(null);
  const next = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      aborter.current?.abort();
      guide.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    if (!busy && stage > 0) next.current?.focus();
  }, [busy, stage]);
  const cursorPreferences = {
    cursorSize: preferences.cursorSize,
    cursorSpeed: preferences.cursorSpeed,
    reducedMotion: preferences.reducedMotion,
  };
  async function advance(): Promise<void> {
    setFailed(false);
    if (stage === 0) {
      setStage(1);
      return;
    }
    if (stage === 4) {
      guide.current?.clear();
      setValue("");
      setStage(0);
      return;
    }
    if (stage === 3) {
      setStage(4);
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    aborter.current = controller;
    try {
      guide.current?.dispose();
      guide.current = createGuide({ allowlist: [window.location.origin], cursorPreferences });
      const result = await guide.current.execute({
        id: crypto.randomUUID(),
        sentenceIndex: 0,
        kind: stage === 1 ? "highlight" : "point",
        target: {
          kind: "text",
          quote: stage === 1 ? letter.highlightQuote : letter.field.sourceQuote,
        },
        payload: {},
      });
      if (!result.success) throw new Error("TUTORIAL_TARGET_UNAVAILABLE");
      if (stage === 2) {
        setStage(3);
        await typeFieldValue(
          {
            value: letter.field.value,
            pace: ONBOARDING_CONFIG.typingPaceMs,
            provenance: { source: { kind: "statement", quote: letter.field.sourceQuote } },
          },
          {
            signal: controller.signal,
            reducedMotion: readCursorPreferences(document, cursorPreferences).reducedMotion,
            paceMultiplier: 1 / preferences.cursorSpeed,
            onValue: setValue,
          },
        );
      } else setStage(2);
    } catch {
      if (!controller.signal.aborted) {
        setFailed(true);
        if (stage === 2) {
          setStage(2);
          setValue("");
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }
  return (
    <div className={styles.tutorial}>
      <p>{copy.intro}</p>
      {stage > 0 && (
        <article className={styles.letter} lang="de-AT" aria-labelledby={`${id}-letter`}>
          <h4 id={`${id}-letter`}>{letter.title}</h4>
          <p>{letter.notice}</p>
          {letter.paragraphs.map((paragraph) => (
            <p key={paragraph}>
              {stage >= 2 && paragraph === letter.highlightQuote ? (
                <mark>{paragraph}</mark>
              ) : (
                paragraph
              )}
            </p>
          ))}
        </article>
      )}
      {stage >= 3 && (
        <fieldset className={styles.group}>
          <legend>{copy.group}</legend>
          <label htmlFor={`${id}-name`}>{letter.field.label}</label>
          <div className={styles.field}>
            <input
              id={`${id}-name`}
              value={value}
              readOnly
              lang="de-AT"
              aria-describedby={`${id}-source ${id}-state`}
            />
            {busy && (
              <span
                className={styles.cursor}
                aria-hidden="true"
                style={{ width: preferences.cursorSize, height: preferences.cursorSize }}
              />
            )}
          </div>
          <p id={`${id}-source`}>
            {copy.source}: <q lang="de-AT">{letter.field.sourceQuote}</q>
          </p>
          <p id={`${id}-state`}>{stage === 4 ? copy.confirmed : copy.draft}</p>
        </fieldset>
      )}
      <p role="status" aria-atomic="true">
        {failed ? copy.error : copy.captions[stage]}
      </p>
      <button ref={next} type="button" disabled={busy} onClick={() => void advance()}>
        {[copy.open, copy.highlight, copy.fill, copy.confirm, copy.replay][stage]}
      </button>
    </div>
  );
}
