"use client";

import type { Preferences } from "@lotse/brain/preferences/schema";
import { useRouter } from "next/navigation";
import { type FormEvent, type JSX, useEffect, useRef, useState } from "react";
import { setAnalyticsConsent } from "@/analytics/client.ts";
import type { shellCopy } from "../shell/copy.ts";
import { SettingsSaveError, savePreferences } from "./client.ts";
import { Connections, connectionStatusLabel, useHealthDetails } from "./connections.tsx";
import { settingsCopy } from "./copy.ts";
import { PreferenceFields } from "./fields.tsx";
import { HelperSettings } from "./helpers.tsx";
import { panelsCopy } from "./panels-copy.ts";
import { PrivacyActions } from "./privacy.tsx";
import styles from "./settings.module.css";

type ShellCopy = (typeof shellCopy)["de"];
export function Settings({
  copy,
  initial,
}: {
  copy: ShellCopy;
  initial: Preferences;
}): JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const labels = settingsCopy[value.language];
  const panels = panelsCopy[value.language];
  const connections = useHealthDetails(open);
  const provider = connections.health?.connections.find((item) => item.id === "elevenlabs");
  useEffect(() => {
    setValue(initial);
    setAnalyticsConsent(initial.analyticsConsent);
    return () => setAnalyticsConsent(false);
  }, [initial]);
  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setStatus("");
    try {
      // Save only edits, so the header's quick autonomy control cannot be overwritten by stale values.
      const changed = Object.fromEntries(
        Object.entries(value).filter(([key, item]) => item !== initial[key as keyof Preferences]),
      );
      const saved = await savePreferences(changed);
      setValue(saved);
      setStatus(settingsCopy[saved.language].saved);
      const location = new URL(window.location.href);
      if (location.searchParams.has("lang")) {
        location.searchParams.delete("lang");
        router.replace(`${location.pathname}${location.search}${location.hash}`, { scroll: false });
      } else router.refresh();
    } catch (error) {
      setStatus(error instanceof SettingsSaveError && error.busy ? labels.busy : labels.error);
    } finally {
      setPending(false);
    }
  }
  return (
    <details
      ref={details}
      className={styles.settings}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && details.current?.open) {
          details.current.open = false;
          summary.current?.focus();
        }
      }}
    >
      <summary ref={summary}>{copy.settings}</summary>
      <div className={styles.drawer} lang={value.language === "de" ? "de-AT" : "en"}>
        <div className={styles.heading}>
          <h2>{panels.title}</h2>
          <p>{panels.intro}</p>
        </div>
        <form onSubmit={save} aria-busy={pending}>
          <fieldset disabled={pending} className={styles.formFields}>
            <div className={styles.grid}>
              <section className={styles.panel} aria-labelledby="settings-profile">
                <div className={styles.panelHeading}>
                  <div>
                    <h3 id="settings-profile">{panels.profile}</h3>
                    <p>{panels.profileHelp}</p>
                  </div>
                </div>
                <PreferenceFields
                  value={value}
                  onChange={setValue}
                  copy={labels}
                  section="profile"
                />
                <PreferenceFields
                  value={value}
                  onChange={setValue}
                  copy={labels}
                  section="accessibility"
                />
              </section>
              <section className={styles.panel} aria-labelledby="settings-assistant">
                <div className={styles.panelHeading}>
                  <div>
                    <h3 id="settings-assistant">{panels.assistant}</h3>
                    <p>{panels.assistantHelp}</p>
                  </div>
                </div>
                <PreferenceFields
                  value={value}
                  onChange={setValue}
                  copy={labels}
                  section="assistant"
                  autonomyHelp={panels.levelHelp[value.autonomyLevel]}
                />
                <p className={styles.note}>{panels.approval}</p>
              </section>
              <section className={styles.panel} aria-labelledby="settings-voice">
                <div className={styles.panelHeading}>
                  <div>
                    <h3 id="settings-voice">{panels.voice}</h3>
                    <p>{panels.voiceHelp}</p>
                  </div>
                </div>
                <div className={styles.connectionLine}>
                  <strong>{panels.provider}</strong>
                  <span className={styles.badge} data-state={provider?.status}>
                    {connectionStatusLabel(provider, connections.failed, panels)}
                  </span>
                </div>
                <h4>{panels.systemVoice}</h4>
                <PreferenceFields value={value} onChange={setValue} copy={labels} section="voice" />
                <div className={styles.macKey}>
                  <strong>{panels.macKey}</strong>
                  <p>{panels.macHelp}</p>
                </div>
              </section>
              <section className={styles.panel} aria-labelledby="settings-privacy">
                <div className={styles.panelHeading}>
                  <div>
                    <h3 id="settings-privacy">{panels.privacy}</h3>
                    <p>{panels.privacyHelp}</p>
                  </div>
                </div>
                <PreferenceFields
                  value={value}
                  onChange={setValue}
                  copy={labels}
                  section="privacy"
                />
                <PrivacyActions
                  copy={panels}
                  resetCopy={copy}
                  onStatus={setStatus}
                  onBusy={setPending}
                />
              </section>
            </div>
            <div className={styles.saveBar}>
              <p>{panels.saveHint}</p>
              <button type="submit">{pending ? labels.saving : labels.save}</button>
            </div>
          </fieldset>
        </form>
        {status && (
          <p className={styles.feedback} role="status" aria-atomic="true">
            {status}
          </p>
        )}
        {open && (
          <div className={styles.grid}>
            <HelperSettings copy={panels} />
            <Connections copy={panels} state={connections} />
          </div>
        )}
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            if (details.current) details.current.open = false;
            summary.current?.focus();
          }}
        >
          {panels.close}
        </button>
      </div>
    </details>
  );
}
