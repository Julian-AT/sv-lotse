"use client";

import type { Preferences } from "@lotse/brain/preferences/schema";
import { useRouter } from "next/navigation";
import { type FormEvent, type JSX, useEffect, useRef, useState } from "react";
import { captureAnalytics } from "@/analytics/client.ts";
import { onboardingStepCompleted } from "@/analytics/product.ts";
import styles from "../shell/shell.module.css";
import { SettingsSaveError, savePreferences } from "./client.ts";
import { settingsCopy } from "./copy.ts";
import { PreferenceFields } from "./fields.tsx";
import { OnboardingTutorial } from "./onboarding-tutorial.tsx";
import { tutorialCopy } from "./tutorial-copy.ts";

export function Onboarding({ initial }: { initial: Preferences }): JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const stepStarted = useRef(performance.now());
  const copy = settingsCopy[value.language];
  const tutorial = tutorialCopy[value.language];
  const steps = [...copy.steps, tutorial.title];
  useEffect(() => {
    if (step > 0) heading.current?.focus();
  }, [step]);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (step < steps.length - 1) {
      void captureAnalytics(onboardingStepCompleted(step, stepStarted.current, performance.now()));
      stepStarted.current = performance.now();
      setStep(step + 1);
      return;
    }
    await finish();
  }
  async function finish(): Promise<void> {
    const completed = onboardingStepCompleted(step, stepStarted.current, performance.now());
    setPending(true);
    setStatus("");
    try {
      await savePreferences({ ...value, onboardingCompleted: true });
      void captureAnalytics(completed);
      router.refresh();
      document.getElementById("welcome-title")?.focus();
    } catch (error) {
      setStatus(error instanceof SettingsSaveError && error.busy ? copy.busy : copy.error);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className={styles.onboarding}
      aria-labelledby="setup-title"
      lang={value.language === "de" ? "de-AT" : "en"}
    >
      <h2 id="setup-title">{copy.welcome}</h2>
      <p>{copy.intro}</p>
      <ol className={styles.steps}>
        {steps.map((title, index) => (
          <li key={title} aria-current={index === step ? "step" : undefined}>
            {title}
          </li>
        ))}
      </ol>
      <h3 ref={heading} tabIndex={-1}>
        {steps[step]}
      </h3>
      <form onSubmit={submit} aria-busy={pending}>
        <fieldset disabled={pending} className={styles.unstyledFieldset}>
          {step === 3 ? (
            <OnboardingTutorial preferences={value} />
          ) : (
            <PreferenceFields
              value={value}
              onChange={setValue}
              copy={copy}
              section={step === 0 ? "language" : step === 1 ? "accessibility" : "control"}
            />
          )}
          {step === 1 && (
            <>
              <p>{copy.accessHelp}</p>
              <p>{copy.permissionHelp}</p>
            </>
          )}
          <div className={styles.actions}>
            {step === 3 && (
              <button type="button" onClick={() => void finish()}>
                {tutorial.skip}
              </button>
            )}
            {step > 0 && (
              <button
                type="button"
                onClick={() => {
                  setStep(step - 1);
                  heading.current?.focus();
                }}
              >
                {copy.back}
              </button>
            )}
            <button type="submit">
              {pending ? copy.saving : step < steps.length - 1 ? copy.next : copy.start}
            </button>
          </div>
        </fieldset>
        <p role="status" aria-atomic="true">
          {status}
        </p>
      </form>
      <details>
        <summary>{copy.helper}</summary>
        <a href="/setup-guide" target="_blank" rel="noreferrer">
          {copy.guide}
        </a>
      </details>
    </section>
  );
}
