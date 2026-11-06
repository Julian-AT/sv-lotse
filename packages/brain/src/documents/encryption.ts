import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  DOCUMENT_KEY_BYTES,
  DOCUMENT_KEY_CONTEXT,
  DOCUMENT_NONCE_BYTES,
  DOCUMENT_TAG_BYTES,
} from "./config.ts";
import { DocumentError } from "./schema.ts";

const sealedSchema = z.object({ iv: z.string(), tag: z.string(), data: z.string() }).strict();
const envelopeSchema = z
  .object({ version: z.literal(1), key: sealedSchema, content: sealedSchema })
  .strict();
type Sealed = z.infer<typeof sealedSchema>;

function wrappingKey(secret: string): Buffer {
  z.string().min(DOCUMENT_KEY_BYTES).parse(secret);
  return Buffer.from(hkdfSync("sha256", secret, "", DOCUMENT_KEY_CONTEXT, DOCUMENT_KEY_BYTES));
}

function seal(bytes: Uint8Array, key: Buffer, context: string): Sealed {
  const iv = randomBytes(DOCUMENT_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function open(sealed: Sealed, key: Buffer, context: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"), {
    authTagLength: DOCUMENT_TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]);
}

/** Independent random per-document key, wrapped by a purpose-separated server key. */
export function encryptDocument(bytes: Uint8Array, secret: string, context: string): Buffer {
  const key = randomBytes(DOCUMENT_KEY_BYTES);
  return Buffer.from(
    JSON.stringify({
      version: 1,
      key: seal(key, wrappingKey(secret), `${context}/key`),
      content: seal(bytes, key, context),
    }),
  );
}

export function decryptDocument(bytes: Uint8Array, secret: string, context: string): Buffer {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const envelope = envelopeSchema.parse(parsed);
  const key = open(envelope.key, wrappingKey(secret), `${context}/key`);
  return open(envelope.content, key, context);
}

// Preserve originals written before native imports introduced the content envelope.
const originalEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  key: sealedSchema,
  body: sealedSchema,
});
function originalWrappingKey(secret: string): Buffer {
  z.string().min(DOCUMENT_KEY_BYTES).parse(secret);
  return Buffer.from(
    hkdfSync("sha256", secret, "lotse-documents-v1", "document-key-wrapping", DOCUMENT_KEY_BYTES),
  );
}

export function encryptOriginal(bytes: Uint8Array, secret: string, context: string): Buffer {
  const key = randomBytes(DOCUMENT_KEY_BYTES);
  return Buffer.from(
    JSON.stringify({
      version: 1,
      key: seal(key, originalWrappingKey(secret), context),
      body: seal(bytes, key, context),
    }),
  );
}

export function decryptOriginal(bytes: Uint8Array, secret: string, context: string): Buffer {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    const original = originalEnvelopeSchema.safeParse(parsed);
    if (original.success) {
      const value = original.data;
      return open(value.body, open(value.key, originalWrappingKey(secret), context), context);
    }
    return decryptDocument(bytes, secret, context);
  } catch {
    throw new DocumentError("storage_failed");
  }
}
