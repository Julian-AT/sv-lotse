import { z } from "zod";
import { DOCUMENT_UPLOAD_MAX_BYTES } from "./config.ts";

export class DocumentUploadError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "DocumentUploadError";
  }
}

export const documentMediaType = z.enum(["application/pdf", "image/jpeg", "image/png"]);
export const documentUploadId = z.uuid();

export function validateDocument(bytes: Uint8Array, contentType: string): void {
  if (bytes.length > DOCUMENT_UPLOAD_MAX_BYTES)
    throw new DocumentUploadError("DOCUMENT_TOO_LARGE", 413);
  const header = Buffer.from(bytes.subarray(0, 8));
  const valid =
    (contentType === "application/pdf" && header.subarray(0, 5).toString("ascii") === "%PDF-") ||
    (contentType === "image/jpeg" &&
      header[0] === 0xff &&
      header[1] === 0xd8 &&
      header[2] === 0xff) ||
    (contentType === "image/png" && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  if (!valid) throw new DocumentUploadError("INVALID_DOCUMENT", 415);
}

/** The byte limit is enforced while streaming, including missing or misleading Content-Length. */
export async function readDocumentBody(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > DOCUMENT_UPLOAD_MAX_BYTES)
    throw new DocumentUploadError("DOCUMENT_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DocumentUploadError("EMPTY_DOCUMENT", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > DOCUMENT_UPLOAD_MAX_BYTES) {
        await reader.cancel();
        throw new DocumentUploadError("DOCUMENT_TOO_LARGE", 413);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new DocumentUploadError("EMPTY_DOCUMENT", 400);
  return Buffer.concat(chunks, length);
}
