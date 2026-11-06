import { BoundingBoxSchema, FactSchema } from "@lotse/protocol";
import { z } from "zod";
import { DOCUMENT_MAX_LINES, DOCUMENT_MAX_PAGES, DOCUMENT_MAX_TEXT } from "./config.ts";

export const documentBoxSchema = BoundingBoxSchema.refine(
  (box) =>
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= 1.000001 &&
    box.y + box.height <= 1.000001,
);
export const documentLineSchema = z.strictObject({
  text: z.string().min(1),
  bbox: documentBoxSchema,
});
export const documentPageSchema = z.strictObject({
  page: z.int().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  text: z.string().max(DOCUMENT_MAX_TEXT),
  lines: z.array(documentLineSchema).max(DOCUMENT_MAX_LINES),
  method: z.enum(["text_layer", "vision", "device_ocr"]),
});
export const documentPagesSchema = z
  .array(documentPageSchema)
  .min(1)
  .max(DOCUMENT_MAX_PAGES)
  .superRefine((pages, ctx) => {
    if (
      pages.some(
        (page, index) =>
          page.page !== index + 1 || page.text !== page.lines.map((line) => line.text).join("\n"),
      ) ||
      pages.reduce((sum, page) => sum + page.text.length, 0) > DOCUMENT_MAX_TEXT
    )
      ctx.addIssue({ code: "custom", message: "Invalid document pages" });
  });
export const statementTypeSchema = z.enum(["documented_recommendation", "administrative_fact"]);
export const statementSchema = z.strictObject({
  type: statementTypeSchema,
  quote: z.string().min(1).max(DOCUMENT_MAX_TEXT),
  page: z.int().positive(),
  bbox: documentBoxSchema,
});
export const statementCandidateSchema = statementSchema.omit({ bbox: true });
export const extractionSchema = z.object({
  statements: z.array(statementCandidateSchema).max(250),
});
export const proposalSchema = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  subjectId: z.uuid(),
  documentId: z.uuid(),
  documentHash: z.string().min(1),
  statement: statementSchema,
  expiresAt: z.number().int(),
});
export const confirmFactSchema = z.strictObject({
  proposalToken: z.string().min(1).max(DOCUMENT_MAX_TEXT),
  confirmed: z.literal(true),
  value: z.string().trim().min(1).max(10_000).optional(),
});
export const factQuerySchema = z.strictObject({
  subjectId: z.uuid(),
  caseId: z.uuid().optional(),
  factTypes: z.array(z.string().min(1)).optional(),
});
export const factMutationSchema = z.strictObject({ subjectId: z.uuid(), factId: z.uuid() });
export const factEditSchema = factMutationSchema.extend({
  value: z.string().trim().min(1).max(10_000),
  confirmed: z.literal(true),
});
export const storedFactSchema = FactSchema;
export type DocumentPage = z.infer<typeof documentPageSchema>;
export type DocumentLine = z.infer<typeof documentLineSchema>;
export type DocumentStatement = z.infer<typeof statementSchema>;
export type FactProposal = z.infer<typeof proposalSchema>;
export type DocumentErrorCode =
  | "invalid_input"
  | "access_denied"
  | "document_not_ready"
  | "limits_exceeded"
  | "unsupported_file"
  | "invalid_pdf"
  | "ocr_failed"
  | "extraction_failed"
  | "ungrounded_statement"
  | "invalid_proposal"
  | "storage_failed"
  | "persistence_failed";
export class DocumentError extends Error {
  constructor(public readonly code: DocumentErrorCode) {
    super(code);
    this.name = "DocumentError";
  }
}
export async function documentOperation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(error instanceof z.ZodError ? "invalid_input" : "persistence_failed");
  }
}
