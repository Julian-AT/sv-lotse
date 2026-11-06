import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { FORM_VIEWER_CONFIG, formPdfUrl } from "./config.ts";

export interface LoadedFormPdf {
  document: PDFDocumentProxy;
  destroy: () => Promise<void>;
}
export async function loadFormPdf(instanceId: string, signal: AbortSignal): Promise<LoadedFormPdf> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `${FORM_VIEWER_CONFIG.pdfAssets}build/pdf.worker.min.mjs`;
  const response = await fetch(formPdfUrl(instanceId), {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("FORM_PDF_UNAVAILABLE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  const loading = pdfjs.getDocument({
    data: bytes,
    verbosity: 0,
    enableXfa: false,
    cMapUrl: `${FORM_VIEWER_CONFIG.pdfAssets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${FORM_VIEWER_CONFIG.pdfAssets}standard_fonts/`,
    wasmUrl: `${FORM_VIEWER_CONFIG.pdfAssets}wasm/`,
  });
  const abort = (): void => {
    void loading.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const document = await loading.promise;
    signal.throwIfAborted();
    return {
      document,
      destroy: async () => {
        signal.removeEventListener("abort", abort);
        await loading.destroy();
      },
    };
  } catch {
    signal.removeEventListener("abort", abort);
    await loading.destroy();
    throw new Error("FORM_PDF_UNAVAILABLE");
  }
}

export function renderFormPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  zoom: number,
): { done: Promise<void>; cancel: () => void } {
  const viewport = page.getViewport({ scale: zoom });
  const ratio = Math.min(
    window.devicePixelRatio || 1,
    FORM_VIEWER_CONFIG.maxPixelRatio,
    Math.sqrt(FORM_VIEWER_CONFIG.maxCanvasPixels / (viewport.width * viewport.height)),
  );
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  const task = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
  return { done: task.promise, cancel: () => task.cancel() };
}
