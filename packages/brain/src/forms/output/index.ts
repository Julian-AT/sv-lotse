import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { formInstances } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../../agent/context.ts";
import { canonicalJson } from "../../approvals/canonical.ts";
import { resolveContext, type SessionIdentity } from "../../conversation/store.ts";
import {
  emitProductEvent,
  type ProductEventSink,
  packageBuiltEvent,
} from "../../telemetry/product-events.ts";
import { contracts } from "../../tools/contracts/index.ts";
import { authorizeFormCase, instanceForContext } from "../instances/access.ts";
import { getTemplate, readTemplateAsset } from "../registry/index.ts";
import { FormError, type FormToolResult, type Template, templateSchema } from "../schema.ts";
import { packageLetter } from "./letter.ts";
import { renderFormPdf } from "./render.ts";

async function renderInstance(template: Template, fields: unknown): Promise<Uint8Array> {
  return renderFormPdf(await readTemplateAsset(template), templateSchema(template), fields);
}

export async function buildFormPackage(
  db: DatabaseClient,
  raw: unknown,
  context: RuntimeContext,
  analytics?: ProductEventSink,
): Promise<FormToolResult<"package.build">> {
  const input = contracts["package.build"].input.parse(raw);
  if (input.caseId !== context.caseId) throw new FormError("access_denied");
  const instance = await instanceForContext(db, input.formInstanceId, context);
  const template = await getTemplate(db, instance.templateId);
  const pdf = await renderInstance(template, instance.fields);
  const pdfKey = `forms/instances/${instance.id}/${randomUUID()}.pdf`;
  const storage = createObjectStorage();
  let previousOutput: string | null = null;
  try {
    await storage.put(pdfKey, pdf, "application/pdf");
    await db.transaction(async (tx) => {
      const current = await instanceForContext(tx, instance.id, context, true);
      if (
        current.templateId !== instance.templateId ||
        canonicalJson(current.fields) !== canonicalJson(instance.fields)
      )
        throw new FormError("invalid_fields");
      previousOutput = current.outputKey;
      await tx
        .update(formInstances)
        .set({ outputKey: pdfKey })
        .where(eq(formInstances.id, instance.id));
    });
  } catch (error) {
    await storage.delete(pdfKey);
    throw error;
  } finally {
    storage.close();
  }
  if (previousOutput && previousOutput !== pdfKey) {
    const cleanup = createObjectStorage();
    try {
      await cleanup.delete(previousOutput);
    } finally {
      cleanup.close();
    }
  }
  const letter = await packageLetter(db, template, context);
  emitProductEvent(analytics, packageBuiltEvent(template.id, letter.attachmentChecklist.length));
  return { pdfKey, ...letter };
}

/** Derive case, subject and actor on the server; HTTP callers supply only an instance id. */
export async function buildFormPackageForSession(
  db: DatabaseClient,
  identity: SessionIdentity,
  instanceId: string,
  analytics?: ProductEventSink,
): Promise<FormToolResult<"package.build">> {
  const [instance] = await db
    .select()
    .from(formInstances)
    .where(eq(formInstances.id, z.uuid().parse(instanceId)));
  if (!instance) throw new FormError("not_found");
  await authorizeFormCase(db, identity.userId, instance.caseId, instance.subjectId);
  const context = await db.transaction((tx) =>
    resolveContext(
      tx,
      {
        caseId: instance.caseId,
        subjectId: instance.subjectId,
        inputKind: "text",
        capsule: {},
        actionResults: [],
      },
      identity,
    ),
  );
  return buildFormPackage(
    db,
    { caseId: instance.caseId, formInstanceId: instance.id },
    context,
    analytics,
  );
}

/** The HTTP adapter passes only a server-authenticated identity. Render afresh, never serve stale drafts. */
export async function downloadFormPdf(
  db: DatabaseClient,
  userId: string,
  instanceId: string,
): Promise<Uint8Array> {
  const [instance] = await db
    .select()
    .from(formInstances)
    .where(eq(formInstances.id, z.uuid().parse(instanceId)));
  if (!instance) throw new FormError("not_found");
  await authorizeFormCase(db, userId, instance.caseId, instance.subjectId);
  const template = await getTemplate(db, instance.templateId);
  const pdf = await renderInstance(template, instance.fields);
  // Recheck after rendering: deletion or a correction during rendering cannot expose a stale export.
  const [current] = await db
    .select()
    .from(formInstances)
    .where(and(eq(formInstances.id, instance.id), eq(formInstances.caseId, instance.caseId)));
  if (
    !current ||
    current.templateId !== instance.templateId ||
    canonicalJson(current.fields) !== canonicalJson(instance.fields)
  )
    throw new FormError("invalid_fields");
  return pdf;
}

export { renderFormPdf } from "./render.ts";
