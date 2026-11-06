"use client";

import { useRouter } from "next/navigation";
import { type ReactElement, useEffect, useId, useState } from "react";
import styles from "../shell/shell.module.css";
import { AllowedFillPages } from "./allowed-pages.tsx";
import {
  AUTONOMY_CHANGED_EVENT,
  AUTONOMY_SETTINGS_URL,
  type Level,
  levelSchema,
  settingSchema,
} from "./config.ts";
import { autonomyCopy } from "./copy.ts";
import autonomyStyles from "./settings.module.css";

export function AutonomySettings({
  language,
  initialLevel,
}: {
  language: "de" | "en";
  initialLevel?: Level;
}): ReactElement {
  const router = useRouter();
  const copy = autonomyCopy[language];
  const id = useId();
  const [current, setCurrent] = useState<Level | undefined>(initialLevel);
  const [selected, setSelected] = useState<Level>(initialLevel ?? "L3");
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<"saved" | "error">();
  useEffect(() => {
    if (initialLevel) {
      setCurrent(initialLevel);
      setSelected(initialLevel);
    }
    const controller = new AbortController();
    let generation = 0;
    async function load(): Promise<void> {
      const version = ++generation;
      try {
        const response = await fetch(AUTONOMY_SETTINGS_URL, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("AUTONOMY_FAILED");
        const { autonomyLevel } = settingSchema.parse(await response.json());
        if (!controller.signal.aborted && version === generation) {
          setCurrent(autonomyLevel);
          setSelected(autonomyLevel);
        }
      } catch {
        if (!controller.signal.aborted && version === generation) setStatus("error");
      }
    }
    if (!initialLevel) void load();
    window.addEventListener(AUTONOMY_CHANGED_EVENT, load);
    return () => {
      controller.abort();
      window.removeEventListener(AUTONOMY_CHANGED_EVENT, load);
    };
  }, [initialLevel]);

  async function change(): Promise<void> {
    setPending(true);
    setStatus(undefined);
    try {
      const response = await fetch(AUTONOMY_SETTINGS_URL, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autonomyLevel: selected, confirmed: true }),
      });
      if (!response.ok) throw new Error("AUTONOMY_FAILED");
      const { autonomyLevel } = settingSchema.parse(await response.json());
      setCurrent(autonomyLevel);
      setSelected(autonomyLevel);
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <fieldset className={autonomyStyles.control} aria-label={copy.title}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-panel`}
        onClick={() => setExpanded((value) => !value)}
      >
        {current ? `${copy.title}: ${copy.levels[current]}` : copy.loading}
      </button>
      <div id={`${id}-panel`} className={styles.settingsPanel} hidden={!expanded}>
        <p id={`${id}-help`}>{copy.help}</p>
        <label htmlFor={id}>{copy.choose}</label>
        <select
          id={id}
          value={selected}
          disabled={!current || pending}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            setSelected(levelSchema.parse(event.target.value));
            setStatus(undefined);
          }}
        >
          {levelSchema.options.map((level) => (
            <option key={level} value={level}>
              {copy.levels[level]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={change}
          disabled={!current || pending || selected === current}
          aria-busy={pending}
        >
          {pending ? copy.saving : copy.confirm}
        </button>
        <p aria-live="polite">{status ? copy[status] : ""}</p>
        {expanded && current === "L3" && <AllowedFillPages language={language} />}
      </div>
    </fieldset>
  );
}
