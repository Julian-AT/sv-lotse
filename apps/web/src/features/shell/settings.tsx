"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./shell.module.css";

type SettingsCopy = {
  settings: string;
  reset: string;
  resetting: string;
  resetDone: string;
  resetError: string;
  resetHelp: string;
};

export function Settings({ copy }: { copy: SettingsCopy }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");

  async function resetSession() {
    setPending(true);
    setStatus("");
    try {
      const response = await fetch("/api/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Session reset failed");
      setStatus(copy.resetDone);
      router.refresh();
    } catch {
      setStatus(copy.resetError);
    } finally {
      setPending(false);
    }
  }

  return (
    <details>
      <summary>{copy.settings}</summary>
      <div className={styles.settingsPanel}>
        <p>{copy.resetHelp}</p>
        <button type="button" onClick={resetSession} disabled={pending} aria-busy={pending}>
          {pending ? copy.resetting : copy.reset}
        </button>
        <p role="status">{status}</p>
      </div>
    </details>
  );
}
