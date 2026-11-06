import { caseSteps, documents } from "@lotse/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "./persistence.ts";
import { type JsonValue, ProcessError } from "./schema.ts";

export async function validateEvidence(
  tx: Transaction,
  caseId: string,
  subjectId: string,
  evidence: Record<string, JsonValue> | undefined,
): Promise<void> {
  const kind = evidence?.type ?? evidence?.kind;
  if (kind === "document_present") {
    const id = z.uuid().safeParse(evidence?.documentId);
    if (!id.success) throw new ProcessError("INVALID_EVIDENCE");
    const [document] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, id.data),
          eq(documents.subjectId, subjectId),
          eq(documents.ocrStatus, "completed"),
        ),
      );
    if (!document) throw new ProcessError("INVALID_EVIDENCE");
  }
  if (kind === "artefact_built") {
    const rows = await tx
      .select({ artifacts: caseSteps.linkedArtifacts })
      .from(caseSteps)
      .where(eq(caseSteps.caseId, caseId));
    const found = rows.some((row) =>
      row.artifacts.some(
        (artifact) =>
          artifact !== null &&
          typeof artifact === "object" &&
          !Array.isArray(artifact) &&
          artifact.id === evidence?.artifactId,
      ),
    );
    if (!found) throw new ProcessError("INVALID_EVIDENCE");
  }
}
