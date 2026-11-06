import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { parseBrainConfig } from "@lotse/brain/config";
import { detectFields } from "@lotse/brain/forms/detect";
import { createDatabase, type Database } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { caseActors, cases, formTemplates, subjects, users } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { loadCatalog, loadKnowledge } from "@lotse/knowledge";
import {
  FetchError,
  IngestionFetcher,
  ingestSource,
  loadRegistry,
  resolveEmbedder,
} from "@lotse/knowledge/ingest";
import { JsonObjectSchema } from "@lotse/protocol";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  DEMO_INGEST_TIMEOUT_MS,
  DEMO_ROOT,
  type DemoManifest,
  demoAsset,
  loadDemoManifest,
} from "./config.ts";

function log(event: string, fields: Record<string, string | number> = {}): void {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

const providerErrorSchema = z.object({ statusCode: z.int().min(100).max(599) });
function providerStatus(error: unknown): number | undefined {
  const direct = providerErrorSchema.safeParse(error);
  if (direct.success) return direct.data.statusCode;
  const retried = z.object({ lastError: providerErrorSchema }).safeParse(error);
  return retried.success ? retried.data.lastError.statusCode : undefined;
}

async function ingest(database: Database, manifest: DemoManifest): Promise<void> {
  const registry = await loadRegistry();
  const fetcher = new IngestionFetcher(registry.allowlist.origins.map(({ origin }) => origin));
  // Without a working embedding provider the sources are still indexed for full-text search.
  const embedder = await resolveEmbedder();
  for (const source of manifest.sources) {
    const result = await ingestSource(database, fetcher, source, embedder).catch(
      (error: unknown) => {
        const status = providerStatus(error);
        log("demo_source_failed", {
          origin: new URL(source.url).origin,
          code:
            error instanceof FetchError
              ? error.code
              : status === 429
                ? "PROVIDER_LIMIT"
                : "INDEX_FAILED",
          ...(status ? { status } : {}),
        });
        throw error;
      },
    );
    log("demo_source", { origin: new URL(source.url).origin, status: result.status });
    if (!["indexed", "unchanged", "not_modified"].includes(result.status))
      throw new Error("DEMO_SOURCE_NOT_INDEXED");
  }
}

async function registerForm(database: Database, manifest: DemoManifest): Promise<void> {
  const bytes = await readFile(demoAsset(manifest.form.file));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const source = `svbox:${manifest.form.file}`;
  const key = `forms/original/${hash}.pdf`;
  const detected = await detectFields(bytes, {
    mode: "acroform",
    vision: "disabled",
    signal: AbortSignal.timeout(DEMO_INGEST_TIMEOUT_MS),
  });
  if (!detected.fields.length) throw new Error("DEMO_FORM_HAS_NO_FIELDS");
  // Keep every detected provider section restricted. Only explicit source-label mappings
  // in knowledge data receive reusable administrative fact types; this is not human review.
  const schema = JsonObjectSchema.parse({
    status: "auto",
    pages: detected.pages,
    fields: detected.fields.map((field) => ({
      ...field,
      page: field.box.page,
      validation: {},
      ...(manifest.form.mappings.find((mapping) => mapping.acroField === field.acro_field)
        ? {
            fact_type: manifest.form.mappings.find(
              (mapping) => mapping.acroField === field.acro_field,
            )?.factType,
          }
        : {}),
    })),
    sources: [{ url: source, quote: manifest.form.sourceQuote }],
  });
  const storage = createObjectStorage();
  try {
    await storage.put(key, bytes, "application/pdf");
    await database.db
      .insert(formTemplates)
      .values({
        title: manifest.form.title,
        publisher: manifest.form.publisher,
        source,
        hash,
        format: "acroform",
        pages: detected.pages.length,
        status: "auto",
        schema,
        storageKey: key,
      })
      .onConflictDoNothing({
        target: [formTemplates.source, formTemplates.hash],
      });
    log("demo_form_registered", { pages: detected.pages.length, fields: detected.fields.length });
  } finally {
    storage.close();
  }
}

async function createSubject(
  database: Database,
  manifest: DemoManifest,
  userId?: string,
): Promise<void> {
  const result = await database.db.transaction(async (tx) => {
    const [owner] = userId
      ? await tx.select().from(users).where(eq(users.id, userId)).for("update")
      : await tx.insert(users).values({}).returning();
    if (!owner) throw new Error("DEMO_USER_NOT_FOUND");
    let [subject] = await tx
      .select()
      .from(subjects)
      .where(and(eq(subjects.createdBy, owner.id), eq(subjects.relationToUser, "self")))
      .limit(1);
    if (!subject)
      [subject] = await tx
        .insert(subjects)
        .values({
          createdBy: owner.id,
          displayName: manifest.displayName,
          relationToUser: "self",
        })
        .returning();
    if (!subject) throw new Error("DEMO_SUBJECT_NOT_CREATED");
    if (!subject.displayName)
      await tx
        .update(subjects)
        .set({ displayName: manifest.displayName })
        .where(eq(subjects.id, subject.id));
    const [demoCase] = await tx
      .insert(cases)
      .values({ subjectId: subject.id, confirmedGoal: "" })
      .returning();
    if (!demoCase) throw new Error("DEMO_CASE_NOT_CREATED");
    await tx
      .insert(caseActors)
      .values({ caseId: demoCase.id, userId: owner.id, role: "subject", shareScope: {} });
    return { userId: owner.id, subjectId: subject.id, caseId: demoCase.id };
  });
  log("demo_subject_ready", result);
}

async function main(): Promise<void> {
  const env = `${DEMO_ROOT}/.env.local`;
  if (existsSync(env)) loadEnvFile(env);
  if (parseBrainConfig().allowStubs) throw new Error("DEMO_REQUIRES_REAL_SERVICES");
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" },
      "catalog-only": { type: "boolean", default: false },
    },
  });
  const userId = values["user-id"] ? z.uuid().parse(values["user-id"]) : undefined;
  const manifest = await loadDemoManifest();
  // Verify both original inputs before applying migrations or writing catalog data.
  await Promise.all([
    readFile(demoAsset(manifest.document)),
    readFile(demoAsset(manifest.form.file)),
  ]);
  const database = createDatabase();
  try {
    await migrateDatabase(database);
    log("demo_migrated");
    await loadCatalog(database, await loadKnowledge());
    log("demo_catalog_loaded");
    await registerForm(database, manifest);
    await ingest(database, manifest);
    if (!values["catalog-only"]) await createSubject(database, manifest, userId);
    log("demo_ready");
  } finally {
    await database.close();
  }
}

main().catch(() => {
  // Never echo driver/provider errors, signing material or document content.
  process.stderr.write('{"event":"demo_seed_failed","code":"DEMO_SETUP_FAILED"}\n');
  process.exitCode = 1;
});
