"use client";

import { type ReactElement, useEffect, useState } from "react";
import { AUTONOMY_CHANGED_EVENT, AUTONOMY_SETTINGS_URL, fillPagesSchema } from "./config.ts";
import { autonomyCopy } from "./copy.ts";

export function AllowedFillPages({ language }: { language: "de" | "en" }): ReactElement {
  const copy = autonomyCopy[language];
  const [pages, setPages] = useState<string[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let generation = 0;
    async function load(): Promise<void> {
      const version = ++generation;
      try {
        const response = await fetch(`${AUTONOMY_SETTINGS_URL}?include=fill-pages`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("AUTONOMY_FAILED");
        const result = fillPagesSchema.parse(await response.json());
        if (!controller.signal.aborted && version === generation) {
          setPages(result.allowedFillPages);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted && version === generation) setFailed(true);
      }
    }
    void load();
    window.addEventListener(AUTONOMY_CHANGED_EVENT, load);
    return () => {
      controller.abort();
      window.removeEventListener(AUTONOMY_CHANGED_EVENT, load);
    };
  }, []);
  return (
    <section aria-label={copy.allowedPages}>
      <h3>{copy.allowedPages}</h3>
      {failed ? (
        <p role="status">{copy.pagesError}</p>
      ) : !pages ? (
        <p role="status">{copy.loading}</p>
      ) : pages.length === 0 ? (
        <p>{copy.noPages}</p>
      ) : (
        <ul>
          {pages.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
