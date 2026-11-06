"use client";

import { type JSX, useEffect, useState } from "react";
import { SETTINGS_CONFIG } from "@/config.ts";
import {
  type Connection,
  type HealthDetails,
  healthDetailsSchema,
  serviceIdSchema,
} from "./health-schema.ts";
import type { PanelsCopy } from "./panels-copy.ts";
import styles from "./settings.module.css";

export function useHealthDetails(enabled: boolean): {
  health: HealthDetails | undefined;
  checking: boolean;
  failed: boolean;
  refresh: () => void;
} {
  const [health, setHealth] = useState<HealthDetails>();
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load(): Promise<void> {
      setChecking(true);
      setFailed(false);
      try {
        const response = await fetch(SETTINGS_CONFIG.healthUrl, {
          credentials: "same-origin",
          cache: revision > 0 ? "reload" : "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("HEALTH_UNAVAILABLE");
        const result = healthDetailsSchema.parse(await response.json());
        if (!controller.signal.aborted) setHealth(result);
      } catch {
        if (!controller.signal.aborted) {
          setHealth(undefined);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setChecking(false);
          timer = setTimeout(() => void load(), SETTINGS_CONFIG.healthPollMs);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, revision]);
  return { health, checking, failed, refresh: () => setRevision((value) => value + 1) };
}

export function connectionStatusLabel(
  connection: Connection | undefined,
  failed: boolean,
  copy: PanelsCopy,
): string {
  if (connection) return connection.status === "verified" ? copy.verified : copy.missing;
  return failed ? copy.missing : copy.checking;
}

export function Connections({
  copy,
  state,
}: {
  copy: PanelsCopy;
  state: ReturnType<typeof useHealthDetails>;
}): JSX.Element {
  return (
    <section className={styles.panel} aria-labelledby="settings-connections">
      <div className={styles.panelHeading}>
        <div>
          <h3 id="settings-connections">{copy.connections}</h3>
          <p>{copy.connectionsHelp}</p>
        </div>
        <button
          type="button"
          className={styles.secondary}
          disabled={state.checking}
          onClick={state.refresh}
        >
          {state.checking ? copy.checking : copy.checkAgain}
        </button>
      </div>
      <ul className={styles.connections} aria-busy={state.checking}>
        {serviceIdSchema.options.map((id) => {
          const connection = state.health?.connections.find((item) => item.id === id);
          return (
            <li key={id} className={styles.connection}>
              <div className={styles.connectionLine}>
                <strong>{copy.services[id]}</strong>
                <span className={styles.badge} data-state={connection?.status}>
                  {connectionStatusLabel(connection, state.failed, copy)}
                </span>
              </div>
              {connection?.status === "missing" && (
                <details className={styles.repair}>
                  <summary>{copy.fix}</summary>
                  <p>{copy.fixes[id]}</p>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={state.checking}
                    onClick={state.refresh}
                  >
                    {copy.checkAgain}
                  </button>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {state.health && (
        <time className={styles.timestamp} dateTime={state.health.checkedAt}>
          {new Date(state.health.checkedAt).toLocaleTimeString()}
        </time>
      )}
      {state.failed && <p role="alert">{copy.healthError}</p>}
    </section>
  );
}
