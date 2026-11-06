import { BoundingBoxSchema } from "@lotse/protocol";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api.js";
import { z } from "zod";
import type { Matrix } from "../forms/detect/geometry.ts";
import { withPdf } from "../forms/detect/pdf.ts";
import { renderPageImage } from "../forms/detect/vision.ts";
import { modelFor } from "../models/index.ts";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_LINES,
  DOCUMENT_MAX_OUTPUT_TOKENS,
  DOCUMENT_MIN_TEXT_CHARACTERS,
  DOCUMENT_MODEL_TIMEOUT_MS,
  DOCUMENT_OCR_ATTEMPTS,
} from "./config.ts";
import { DOCUMENT_OCR_INSTRUCTIONS } from "./copy.ts";
import {
  DocumentError,
  type DocumentLine,
  type DocumentPage,
  documentLineSchema,
  documentPagesSchema,
} from "./schema.ts";
import { textLayerLines } from "./text-layer.ts";

export function fileMediaType(
  bytes: Uint8Array,
): "application/pdf" | "image/png" | "image/jpeg" | "image/webp" {
  if (!bytes.length || bytes.length > DOCUMENT_MAX_BYTES)
    throw new DocumentError("limits_exceeded");
  const head = Buffer.from(bytes.subarray(0, 16));
  if (head.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return "image/jpeg";
  if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP")
    return "image/webp";
  throw new DocumentError("unsupported_file");
}

async function textPage(page: PDFPageProxy, number: number): Promise<DocumentPage> {
  const viewport = page.getViewport({ scale: 1 });
  const lines = textLayerLines(
    await page.getTextContent(),
    viewport.transform as Matrix,
    viewport.width,
    viewport.height,
    number,
  );
  return {
    page: number,
    width: viewport.width,
    height: viewport.height,
    lines,
    text: lines.map((line) => line.text).join("\n"),
    method: "text_layer",
  };
}
async function recognizeImageOnce(
  bytes: Uint8Array,
  mediaType: string,
  signal?: AbortSignal,
): Promise<DocumentLine[]> {
  signal?.throwIfAborted();
  const result = await generateText({
    model: modelFor("extractor"),
    output: Output.object({
      schema: z.object({
        lines: z
          .array(documentLineSchema.extend({ bbox: BoundingBoxSchema }))
          .max(DOCUMENT_MAX_LINES),
      }),
    }),
    instructions: DOCUMENT_OCR_INSTRUCTIONS,
    messages: [{ role: "user", content: [{ type: "file", mediaType, data: bytes }] }],
    maxOutputTokens: DOCUMENT_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    abortSignal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(DOCUMENT_MODEL_TIMEOUT_MS)])
      : AbortSignal.timeout(DOCUMENT_MODEL_TIMEOUT_MS),
    telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
  });
  return result.output.lines.map((line) =>
    documentLineSchema.parse({
      ...line,
      bbox: {
        ...line.bbox,
        width: Math.min(line.bbox.width, 1 - line.bbox.x),
        height: Math.min(line.bbox.height, 1 - line.bbox.y),
      },
    }),
  );
}
export async function recognizeImage(
  bytes: Uint8Array,
  mediaType: string,
  signal?: AbortSignal,
): Promise<DocumentLine[]> {
  for (let attempt = 0; attempt < DOCUMENT_OCR_ATTEMPTS; attempt++) {
    try {
      return await recognizeImageOnce(bytes, mediaType, signal);
    } catch (error) {
      signal?.throwIfAborted();
      const invalidGeometry =
        error instanceof z.ZodError || NoObjectGeneratedError.isInstance(error);
      if (!invalidGeometry || attempt + 1 === DOCUMENT_OCR_ATTEMPTS)
        throw new DocumentError("ocr_failed");
    }
  }
  throw new DocumentError("ocr_failed");
}

async function pdfPages(document: PDFDocumentProxy, signal?: AbortSignal): Promise<DocumentPage[]> {
  const pages: DocumentPage[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    signal?.throwIfAborted();
    const page = await document.getPage(number);
    try {
      const extracted = await textPage(page, number);
      if (extracted.text.trim().length >= DOCUMENT_MIN_TEXT_CHARACTERS) pages.push(extracted);
      else {
        const lines = await recognizeImage(
          await renderPageImage(document, page, signal),
          "image/png",
          signal,
        );
        pages.push({
          ...extracted,
          lines,
          text: lines.map((line) => line.text).join("\n"),
          method: "vision",
        });
      }
    } finally {
      page.cleanup();
    }
  }
  return documentPagesSchema.parse(pages);
}
export async function readDocumentPages(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<DocumentPage[]> {
  const mediaType = fileMediaType(bytes);
  if (mediaType === "application/pdf") {
    try {
      return await withPdf(bytes, signal, (document) => pdfPages(document, signal));
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof DocumentError) throw error;
      throw new DocumentError("invalid_pdf");
    }
  }
  const lines = await recognizeImage(bytes, mediaType, signal);
  // Image coordinates are normalized; dimensions describe that unit square.
  return documentPagesSchema.parse([
    {
      page: 1,
      width: 1,
      height: 1,
      lines,
      text: lines.map((line) => line.text).join("\n"),
      method: "vision",
    },
  ]);
}
