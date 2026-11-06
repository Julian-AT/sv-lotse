import { FactSchema } from "@lotse/protocol";
import { z } from "zod";

export const CaseSummarySchema = z.strictObject({
  id: z.uuid(),
  subjectId: z.uuid(),
  confirmedGoal: z.string(),
  status: z.enum(["active", "paused", "completed", "archived"]),
  autonomyLevel: z.enum(["L1", "L2", "L3"]),
});
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
export const CasesResponseSchema = z.strictObject({ cases: z.array(CaseSummarySchema) });
export const FactsResponseSchema = z.strictObject({ facts: z.array(FactSchema) });
export const CaseQuerySchema = z.strictObject({
  caseId: z.uuid().transform((id) => id.toLowerCase()),
});
export const FactProposalSchema = FactSchema.extend({
  value: z.string(),
  confirmed: z.literal(false),
  confidence: z.number().default(1),
  proposalToken: z.string().min(1),
});
export const ExtractionResponseSchema = z.object({ proposals: z.array(FactProposalSchema) });
export const UploadResponseSchema = z.object({ documentId: z.uuid(), subjectId: z.uuid() });
export type ReviewableFact = z.infer<typeof FactSchema> & { proposalToken?: string };
