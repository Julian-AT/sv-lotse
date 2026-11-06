"use client";

import type { PDFDocumentProxy, TextLayer } from "pdfjs-dist";
import { type JSX, useEffect, useRef, useState } from "react";
import { PDF_RENDER_SCALE } from "./config.ts";
import { viewerCopy } from "./copy.ts";
import { findQuoteRanges } from "./quote.ts";
import { type HighlightBox, storedQuoteBoxes } from "./stored-lines.ts";
import styles from "./viewer.module.css";
import "pdfjs-dist/web/pdf_viewer.css";

function textBoxes(layer: TextLayer, quote: string, container: HTMLElement): HighlightBox[] {
  const bounds = container.getBoundingClientRect();
  return findQuoteRanges(
    layer.textDivs.map((div) => div.textContent ?? ""),
    quote,
  ).flatMap((match) => {
    const node = layer.textDivs[match.index]?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return [];
    const range = document.createRange();
    range.setStart(node, match.start);
    range.setEnd(node, match.end);
    return [...range.getClientRects()].map((rect) => ({
      x: rect.x - bounds.x,
      y: rect.y - bounds.y,
      width: rect.width,
      height: rect.height,
    }));
  });
}

export function PdfPage({
  pdf,
  page,
  quote,
  storedPages,
  language,
  onMatch,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  quote: string;
  storedPages: unknown[];
  language: "de" | "en";
  onMatch?: (success: boolean) => void;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const layer = useRef<TextLayer | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [boxes, setBoxes] = useState<HighlightBox[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cancelRender: (() => void) | undefined;
    setReady(false);
    setError(false);
    setBoxes([]);
    async function render(): Promise<void> {
      const pdfjs = await import("pdfjs-dist");
      const documentPage = await pdf.getPage(page);
      if (disposed || !canvas.current || !text.current) return;
      const viewport = documentPage.getViewport({ scale: PDF_RENDER_SCALE });
      const surface = canvas.current;
      surface.width = Math.ceil(viewport.width);
      surface.height = Math.ceil(viewport.height);
      setSize({ width: viewport.width, height: viewport.height });
      text.current.replaceChildren();
      const content = await documentPage.getTextContent();
      if (disposed) return;
      const textLayer = new pdfjs.TextLayer({
        textContentSource: content,
        container: text.current,
        viewport,
      });
      if (disposed) return;
      layer.current = textLayer;
      const rendering = documentPage.render({ canvas: surface, viewport });
      cancelRender = () => {
        rendering.cancel();
        textLayer.cancel();
      };
      await Promise.all([rendering.promise, textLayer.render()]);
      if (!disposed) setReady(true);
    }
    void render().catch(() => {
      if (!disposed) setError(true);
    });
    return () => {
      disposed = true;
      cancelRender?.();
      layer.current = null;
    };
  }, [pdf, page]);
  useEffect(() => {
    if (!ready || !text.current || !layer.current || !quote) {
      setBoxes([]);
      return;
    }
    const exact = textBoxes(layer.current, quote, text.current);
    const resolved = exact.length
      ? exact
      : storedQuoteBoxes(storedPages, page, quote, size.width, size.height);
    setBoxes(resolved);
    onMatch?.(resolved.length > 0);
  }, [quote, ready, page, storedPages, size, onMatch]);
  useEffect(() => {
    if (boxes.length)
      text.current?.parentElement
        ?.querySelector<HTMLElement>("[data-quote-box]")
        ?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [boxes]);
  return (
    <>
      {error && <p role="alert">{viewerCopy[language].error}</p>}
      {ready && quote && !boxes.length && <p role="status">{viewerCopy[language].notFound}</p>}
      <div className={styles.scroll}>
        <div className={styles.page} style={{ width: size.width, height: size.height }}>
          <canvas ref={canvas} role="img" aria-label={viewerCopy[language].title} />
          <div ref={text} className="textLayer" />
          {boxes.map((box) => (
            <div
              key={`${box.x}:${box.y}:${box.width}`}
              data-quote-box
              className={styles.box}
              style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    </>
  );
}
