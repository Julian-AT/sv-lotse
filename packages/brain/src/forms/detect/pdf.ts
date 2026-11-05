import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api.js";
import { FieldDetectionError } from "./schema.ts";

const require = createRequire(import.meta.url);
const distribution = dirname(require.resolve("pdfjs-dist/package.json"));

export async function withPdf<T>(
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
  run: (document: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
    throw new FieldDetectionError("invalid_pdf");
  if (bytes.byteLength > 25 * 1024 * 1024) throw new FieldDetectionError("limits_exceeded");
  const loading = getDocument({
    data: Uint8Array.from(bytes),
    verbosity: 0,
    cMapUrl: join(distribution, "cmaps") + sep,
    cMapPacked: true,
    standardFontDataUrl: join(distribution, "standard_fonts") + sep,
    wasmUrl: join(distribution, "wasm") + sep,
  });
  const cancel = () => {
    void loading.destroy();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    let document: PDFDocumentProxy;
    try {
      document = await loading.promise;
    } catch {
      signal?.throwIfAborted();
      throw new FieldDetectionError("invalid_pdf");
    }
    if (document.numPages > 100) throw new FieldDetectionError("limits_exceeded");
    signal?.throwIfAborted();
    return await run(document);
  } finally {
    signal?.removeEventListener("abort", cancel);
    await loading.destroy();
  }
}
