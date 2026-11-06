import { DOCUMENT_MAX_REQUEST_BYTES, DocumentError } from "@lotse/brain/documents";

/** Enforce the limit on actual bytes, including chunked requests without Content-Length. */
export async function readDocumentBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > DOCUMENT_MAX_REQUEST_BYTES))
    throw new DocumentError("limits_exceeded");
  const reader = request.body?.getReader();
  if (!reader) throw new DocumentError("invalid_input");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > DOCUMENT_MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new DocumentError("limits_exceeded");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks, length));
}

export async function readDocumentJson(request: Request): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readDocumentBody(request)));
}
