import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { formTemplates } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { JsonObjectSchema } from "@lotse/protocol";
import { and, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { detectFields } from "../detect/index.ts";
import { FormError, type Template } from "../schema.ts";
import { fetchOfficial, officialOrigins, officialUrl } from "./http.ts";

/** Each call rechecks the official bytes; identical versions reuse their schema and object. */
export async function acquireForm(
  db: DatabaseClient,
  rawUrl: string,
  signal?: AbortSignal,
): Promise<Template> {
  const origins = await officialOrigins();
  const canonical = officialUrl(rawUrl, origins).href;
  const downloaded = await fetchOfficial(canonical, origins, signal);
  if (Buffer.from(downloaded.bytes.subarray(0, 5)).toString("ascii") !== "%PDF-")
    throw new FormError("unsupported_format");
  const hash = createHash("sha256").update(downloaded.bytes).digest("hex");
  const [known] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.source, canonical), eq(formTemplates.hash, hash)));
  if (known) {
    const retrievedAt = new Date();
    await db.update(formTemplates).set({ retrievedAt }).where(eq(formTemplates.id, known.id));
    return { ...known, retrievedAt };
  }
  const document = await PDFDocument.load(downloaded.bytes);
  if (document.getForm().hasXFA()) throw new FormError("unsupported_format");
  const detected = await detectFields(downloaded.bytes, { signal });
  const id = randomUUID();
  const storageKey = `forms/templates/${hash}.pdf`;
  const url = new URL(downloaded.url);
  const lastModified = new Date(downloaded.headers.get("last-modified") ?? "");
  const record = {
    id,
    publisher: url.hostname,
    title:
      document.getTitle()?.trim() ||
      decodeURIComponent(url.pathname.split("/").at(-1) || url.hostname),
    source: canonical,
    hash,
    versionDate: Number.isNaN(lastModified.getTime())
      ? null
      : lastModified.toISOString().slice(0, 10),
    format: document.getForm().getFields().length
      ? ("acroform" as const)
      : detected.fields.some((field) => field.method !== "vision")
        ? ("flat" as const)
        : ("scanned" as const),
    pages: detected.pages.length,
    status: "auto" as const,
    schema: JsonObjectSchema.parse(
      JSON.parse(JSON.stringify({ ...detected, templateId: id, source_url: downloaded.url })),
    ),
    storageKey,
  };
  const storage = createObjectStorage();
  try {
    await storage.put(storageKey, downloaded.bytes, "application/pdf");
  } finally {
    storage.close();
  }
  const [saved] = await db
    .insert(formTemplates)
    .values(record)
    .onConflictDoNothing({ target: [formTemplates.source, formTemplates.hash] })
    .returning();
  if (saved) return saved;
  const [concurrent] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.source, canonical), eq(formTemplates.hash, hash)));
  if (!concurrent) throw new FormError("download_failed");
  return concurrent;
}
