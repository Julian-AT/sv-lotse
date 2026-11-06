"use client";

import { type JSX, useEffect, useId, useState } from "react";
import { z } from "zod";
import { WORKSPACE_REFRESH_MS } from "./config.ts";
import { journeyActionsCopy } from "./journey-actions-copy.ts";
import styles from "./workspace.module.css";

const sourceUrl = z.url({ protocol: /^https?$/ });
const reminderList = z.object({
  reminders: z.array(
    z.object({
      id: z.uuid(),
      dueAt: z.iso.datetime({ offset: true }),
      source: z.object({
        title: z.string(),
        sourceQuote: z.string(),
        date: z.iso.date().optional(),
        provenance: z
          .object({
            documentId: z.uuid().optional(),
            sources: z.array(z.object({ url: sourceUrl, quote: z.string().optional() })).optional(),
            url: sourceUrl.optional(),
          })
          .passthrough(),
      }),
    }),
  ),
});
type Reminder = z.infer<typeof reminderList>["reminders"][number];

function sourceLinks(reminder: Reminder): { url: string; document: boolean }[] {
  const provenance = reminder.source.provenance;
  const urls = [
    ...new Set([
      ...(provenance.sources?.map((source) => source.url) ?? []),
      ...(provenance.url ? [provenance.url] : []),
    ]),
  ];
  return [
    ...urls.map((url) => ({ url, document: false })),
    ...(provenance.documentId
      ? [{ url: `/api/documents/${provenance.documentId}`, document: true }]
      : []),
  ];
}

export function RemindersPanel({
  caseId,
  language,
  revision = 0,
}: {
  caseId: string;
  language: "de" | "en";
  revision?: number;
}): JSX.Element {
  const copy = journeyActionsCopy[language];
  const id = useId();
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setItems(null);
    let running = false;
    async function load(): Promise<void> {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`/api/reminders?${new URLSearchParams({ caseId })}`, {
          cache: revision > 0 || retry > 0 ? "reload" : "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("REMINDERS_FAILED");
        const result = reminderList.parse(await response.json());
        if (!controller.signal.aborted) {
          setItems(result.reminders);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        running = false;
      }
    }
    void load();
    const refresh = (): void => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refresh, WORKSPACE_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [caseId, revision, retry]);
  return (
    <section aria-labelledby={id} className={styles.history}>
      <h2 id={id}>{copy.reminders}</h2>
      {error ? (
        <div role="alert">
          <p>{copy.error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            {copy.retry}
          </button>
        </div>
      ) : items === null ? (
        <p role="status">{copy.loading}</p>
      ) : items.length === 0 ? (
        <p>{copy.noReminders}</p>
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id} className={styles.card}>
                <h3>{item.source.title}</h3>
                <time dateTime={item.source.date ?? item.dueAt}>
                  {item.source.date ??
                    new Intl.DateTimeFormat(language === "de" ? "de-AT" : "en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Europe/Vienna",
                    }).format(new Date(item.dueAt))}
                </time>
                <blockquote>{item.source.sourceQuote}</blockquote>
                {sourceLinks(item).map((link) => (
                  <p key={link.url}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.document ? copy.documentSource : copy.source}
                    </a>
                  </p>
                ))}
              </li>
            ))}
          </ul>
          <a href={`/api/reminders/ics?${new URLSearchParams({ caseId })}`}>{copy.export}</a>
        </>
      )}
    </section>
  );
}
