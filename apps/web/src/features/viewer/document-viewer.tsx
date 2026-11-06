"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { type JSX, useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { DOCUMENTS_URL, PDF_WORKER_URL } from "./config.ts";
import { viewerCopy } from "./copy.ts";
import { PdfPage } from "./pdf-page.tsx";
import styles from "./viewer.module.css";

export interface DocumentSelection {
  actionId?: string;
  documentId: string;
  caseId: string;
  page?: number;
  quote?: string;
}
const metadataSchema = z.object({ pages: z.array(z.unknown()) });

interface DocumentViewerProps {
  selection: DocumentSelection;
  language: "de" | "en";
  onClose: () => void;
  onResolved?: (actionId: string, success: boolean) => void;
}

export function DocumentViewer(props: DocumentViewerProps): JSX.Element {
  return <DocumentViewerSession key={props.selection.documentId} {...props} />;
}

function DocumentViewerSession({
  selection,
  language,
  onClose,
  onResolved,
}: DocumentViewerProps): JSX.Element {
  const copy = viewerCopy[language];
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<unknown[]>([]);
  const [page, setPage] = useState(selection.page ?? 1);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setPage(selection.page ?? 1);
  }, [selection.page]);
  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;
    const abort = new AbortController();
    setPdf(null);
    setFailed(false);
    setPages([]);
    async function load(): Promise<void> {
      const pdfjs = await import("pdfjs-dist");
      if (disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      const parameters = new URLSearchParams({
        caseId: selection.caseId,
        documentId: selection.documentId,
      });
      const url = `${DOCUMENTS_URL}?${parameters}`;
      const metadata = await fetch(`${url}&metadata=1`, {
        signal: abort.signal,
        cache: "no-store",
      });
      if (!metadata.ok) throw new Error("DOCUMENT_UNAVAILABLE");
      const parsed = metadataSchema.parse(await metadata.json());
      if (disposed) return;
      setPages(parsed.pages);
      const task = pdfjs.getDocument({
        url,
        withCredentials: true,
        disableRange: true,
        disableStream: true,
      });
      destroy = () => {
        void task.destroy();
      };
      const document = await task.promise;
      if (disposed) return;
      setPdf(document);
    }
    void load().catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      abort.abort();
      destroy?.();
    };
  }, [selection.documentId, selection.caseId]);
  const onMatch = useCallback(
    (success: boolean): void => {
      if (selection.actionId) onResolved?.(selection.actionId, success);
    },
    [selection.actionId, onResolved],
  );
  const validPage = pdf && page >= 1 && page <= pdf.numPages;
  return (
    <section className={styles.viewer} aria-label={copy.title}>
      <div className={styles.toolbar}>
        <h2>{copy.title}</h2>
        <button type="button" onClick={onClose}>
          {copy.close}
        </button>
        <button type="button" disabled={!pdf || page <= 1} onClick={() => setPage(page - 1)}>
          {copy.previous}
        </button>
        <span>
          {copy.page} {page}
          {pdf ? ` / ${pdf.numPages}` : ""}
        </span>
        <button
          type="button"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          {copy.next}
        </button>
      </div>
      {selection.quote && (
        <blockquote className={styles.quote}>
          <small>{copy.quote}</small>
          <p>{selection.quote}</p>
        </blockquote>
      )}
      {failed || (pdf && !validPage) ? (
        <p role="alert">{copy.error}</p>
      ) : !pdf ? (
        <p role="status">{copy.loading}</p>
      ) : (
        <PdfPage
          onMatch={onMatch}
          pdf={pdf}
          page={page}
          quote={page === (selection.page ?? 1) ? (selection.quote ?? "") : ""}
          storedPages={pages}
          language={language}
        />
      )}
    </section>
  );
}
