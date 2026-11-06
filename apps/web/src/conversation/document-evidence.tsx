"use client";

import type { FactSource } from "@lotse/protocol";
import { type JSX, useEffect, useRef, useState } from "react";
import { FORM_VIEWER_CONFIG } from "../features/form-viewer/config.ts";
import { renderFormPage } from "../features/form-viewer/pdf.ts";
import { WORKSPACE_CONFIG } from "./config.ts";
import styles from "./evidence.module.css";
import { evidenceCopy } from "./evidence-copy.ts";

export function DocumentEvidence({
  source,
  subjectId,
  language,
}: {
  source: FactSource;
  subjectId: string;
  language: "de" | "en";
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const copy = evidenceCopy[language];
  if (source.kind !== "document" || !source.documentId || !source.page || !source.bbox) return null;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{copy.open}</summary>
      {open && <EvidencePage source={source} subjectId={subjectId} language={language} />}
    </details>
  );
}

function EvidencePage({
  source,
  subjectId,
  language,
}: {
  source: FactSource;
  subjectId: string;
  language: "de" | "en";
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [errorStage, setErrorStage] = useState<string>();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const copy = evidenceCopy[language];
  const { documentId, page: pageNumber, bbox, quote } = source;
  useEffect(() => {
    const controller = new AbortController();
    let destroy: (() => Promise<void>) | undefined;
    let cancel: (() => void) | undefined;
    setState("loading");
    void (async () => {
      let stage = "module";
      try {
        const pdfjs = await import("pdfjs-dist");
        stage = "request";
        pdfjs.GlobalWorkerOptions.workerSrc = `${FORM_VIEWER_CONFIG.pdfAssets}build/pdf.worker.min.mjs`;
        const response = await fetch(
          `${WORKSPACE_CONFIG.documentsApi}/${documentId}?${new URLSearchParams({ subjectId })}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("DOCUMENT_UNAVAILABLE");
        stage = "decode";
        const task = pdfjs.getDocument({
          data: new Uint8Array(await response.arrayBuffer()),
          verbosity: 0,
        });
        destroy = () => task.destroy();
        const pdf = await task.promise;
        const page = await pdf.getPage(pageNumber ?? 1);
        if (controller.signal.aborted || !canvas.current) return;
        const viewport = page.getViewport({ scale: 1 });
        setSize({ width: viewport.width, height: viewport.height });
        stage = "render";
        const render = renderFormPage(page, canvas.current, 1);
        cancel = render.cancel;
        await render.done;
        if (!controller.signal.aborted) setState("ready");
      } catch {
        if (!controller.signal.aborted) {
          setErrorStage(stage);
          setState("failed");
        }
      } finally {
        if (controller.signal.aborted) await destroy?.();
      }
    })();
    return () => {
      controller.abort();
      cancel?.();
      void destroy?.();
    };
  }, [documentId, pageNumber, subjectId]);
  return (
    <figure aria-label={copy.source} data-error-stage={errorStage}>
      {state === "loading" && <p role="status">{copy.loading}</p>}
      {state === "failed" && <p role="alert">{copy.error}</p>}
      <div className={styles.page} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        <canvas ref={canvas} aria-label={`${copy.page} ${pageNumber}`} role="img" />
        {state === "ready" && bbox && (
          <mark
            className={styles.highlight}
            title={quote}
            aria-hidden="true"
            style={{
              left: `${bbox.x * 100}%`,
              top: `${bbox.y * 100}%`,
              width: `${bbox.width * 100}%`,
              height: `${bbox.height * 100}%`,
            }}
          />
        )}
      </div>
      <figcaption>
        {copy.page} {pageNumber}: <q>{quote}</q>
      </figcaption>
    </figure>
  );
}
