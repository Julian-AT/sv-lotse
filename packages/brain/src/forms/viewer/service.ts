import type { Database } from "@lotse/db";
import { z } from "zod";
import { FORM_CORRECTION_FACT_TYPE } from "../../config/index.ts";
import {
  type FieldCorrection,
  FieldCorrectionSchema,
  isValidFieldValue,
  type ViewerInstance,
  ViewerInstanceSchema,
} from "./schema.ts";

export class FormViewerError extends Error {
  constructor(public readonly code: "not_found" | "invalid_input" | "unavailable") {
    super(code);
    this.name = "FormViewerError";
  }
}
type Transaction = Parameters<Parameters<Database["sql"]["begin"]>[1]>[0];

async function readRow(sql: Transaction, instanceId: string, userId: string) {
  const [row] = await sql`
    SELECT i.id, i.case_id AS "caseId", i.subject_id AS "subjectId",
      i.template_id AS "templateId", i.fields, t.title, t.schema, t.storage_key AS "storageKey"
    FROM form_instance i JOIN form_template t ON t.id = i.template_id
    JOIN "case" c ON c.id = i.case_id AND c.subject_id = i.subject_id
    JOIN subject s ON s.id = c.subject_id
    WHERE i.id = ${instanceId} AND (
      s.created_by = ${userId} OR EXISTS (
        SELECT 1 FROM case_actor a WHERE a.case_id = c.id AND a.user_id = ${userId}
        AND a.role = 'subject'
      )
    ) FOR UPDATE OF i FOR SHARE OF c, s`;
  if (!row) throw new FormViewerError("not_found");
  return {
    instance: ViewerInstanceSchema.parse(row),
    storageKey: z.string().min(1).parse(row.storageKey),
  };
}

async function operation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FormViewerError) throw error;
    throw new FormViewerError(error instanceof z.ZodError ? "invalid_input" : "unavailable");
  }
}

/** Bind identity only from requireSession. Helpers cannot read unprojected provenance or edit. */
export function createFormViewerService(
  database: Database,
  userId: string,
): {
  read: (instanceId: string) => Promise<{ instance: ViewerInstance; storageKey: string }>;
  correct: (instanceId: string, input: FieldCorrection) => Promise<ViewerInstance>;
} {
  const identity = z.uuid().parse(userId);
  return {
    read: (instanceId) =>
      operation(() =>
        database.sql.begin(async (sql) => readRow(sql, z.uuid().parse(instanceId), identity)),
      ),
    correct: (instanceId, input) =>
      operation(() =>
        database.sql.begin(async (sql) => {
          const correction = FieldCorrectionSchema.parse(input);
          const { instance } = await readRow(sql, z.uuid().parse(instanceId), identity);
          const field = instance.schema.fields.find((item) => item.id === correction.fieldId);
          if (!field || !isValidFieldValue(field, correction.value))
            throw new FormViewerError("invalid_input");
          // A keyboard statement is a real completed interaction, providing the fact's source FK.
          const [turn] = await sql`INSERT INTO turn (case_id, status)
        VALUES (${instance.caseId}, 'completed') RETURNING id`;
          const turnId = z.uuid().parse(turn?.id);
          const source = { kind: "statement" as const, turnId, quote: String(correction.value) };
          const [fact] = await sql`INSERT INTO fact
        (subject_id, type, value, turn_id, source, confidence, confirmed)
        VALUES (${instance.subjectId}, ${field.fact_type ?? FORM_CORRECTION_FACT_TYPE}, ${JSON.stringify(field.fact_type ? correction.value : { formInstanceId: instance.id, fieldId: field.id, value: correction.value })}::jsonb,
          ${turnId}, ${JSON.stringify(source)}::jsonb, 1, true) RETURNING id`;
          const fields = {
            ...instance.fields,
            [field.id]: {
              value: correction.value,
              provenance: { factId: z.uuid().parse(fact?.id), source },
              state: "draft" as const,
              approvalId: null,
            },
          };
          await sql`UPDATE form_instance SET fields = ${JSON.stringify(fields)}::jsonb, output_key = NULL
        WHERE id = ${instance.id}`;
          return ViewerInstanceSchema.parse({ ...instance, fields });
        }),
      ),
  };
}
