"use client";
import { type ReactElement, useEffect, useState } from "react";
import { browserSessionSchema, relativeRequest } from "./api.ts";
import type { RelativesCopy } from "./copy.ts";
import styles from "./relatives.module.css";
import { RelativeSessionPanel } from "./session.tsx";

export function HelperView({ copy }: { copy: RelativesCopy }): ReactElement {
  const [token, setToken] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = (): void => {
      const value = window.location.hash.slice(1);
      setToken(/^[0-9a-f]{64}$/.test(value) ? value : "");
      setId(null);
      setError(false);
    };
    refresh();
    window.addEventListener("hashchange", refresh);
    return () => window.removeEventListener("hashchange", refresh);
  }, []);
  async function join(): Promise<void> {
    setBusy(true);
    setError(false);
    try {
      const session = await relativeRequest("/api/relatives/join", browserSessionSchema, { token });
      setId(session.id);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-labelledby="helper-title">
      <h1 id="helper-title">{copy.helperTitle}</h1>
      <p>{copy.scope}</p>
      {!id ? (
        <button type="button" disabled={busy || !token} onClick={() => void join()}>
          {copy.join}
        </button>
      ) : (
        <RelativeSessionPanel id={id} participantRole="helper" copy={copy} />
      )}
      {!token ? <p>{copy.invalid}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {copy.error}
        </p>
      ) : null}
    </section>
  );
}
