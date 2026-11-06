import { benefits, documents } from "@lotse/db/schema";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { requireDocumentRead, subjectAccess } from "../../../documents/access.ts";
import { DocumentError } from "../../../documents/schema.ts";
import { contracts } from "../../contracts/index.ts";
import { benefitRecordSchema } from "../../contracts/records.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "documents.checklist": async (raw, context) => {
      const input = contracts["documents.checklist"].input.parse(raw);
      if (input.subjectId !== context.subjectId) throw new DocumentError("access_denied");
      const db = requireDatabase(deps);
      return db.transaction(async (tx) => {
        requireDocumentRead(
          await subjectAccess(tx, context.userId, input.subjectId, context.caseId),
        );
        const identifier = z.uuid().safeParse(input.benefitId);
        const [benefit] = await tx
          .select()
          .from(benefits)
          .where(
            or(
              eq(benefits.key, input.benefitId),
              identifier.success ? eq(benefits.id, identifier.data) : undefined,
            ),
          );
        if (!benefit) throw new DocumentError("invalid_input");
        const record = benefitRecordSchema
          .pick({ documents: true, as_of: true })
          .strip()
          .parse(benefit.record);
        const available = await tx
          .select({ type: documents.type })
          .from(documents)
          .where(
            and(eq(documents.subjectId, input.subjectId), eq(documents.ocrStatus, "completed")),
          );
        const types = new Set(available.map((document) => document.type));
        return record.documents.map((document) => ({
          type: document.id,
          title: document.name_de,
          status: types.has(document.id) ? "have" : document.required ? "missing" : "obtainable",
          whereToObtain: document.obtain_from,
          sources: [{ url: document.source.url, quote: document.source.quote, asOf: record.as_of }],
        }));
      });
    },
  };
}
