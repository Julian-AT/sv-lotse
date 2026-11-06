import { z } from "zod";

/** Exact fact types; an empty list grants no access. No wildcard or implicit defaults. */
export const shareScopeSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("full") }),
  z.strictObject({ mode: z.literal("restricted"), factTypes: z.array(z.string().min(1)) }),
]);
export type ShareScope = z.infer<typeof shareScopeSchema>;

export const createSubjectInput = z.strictObject({
  displayName: z.string().trim().min(1),
  relationToUser: z.string().trim().min(1),
});
export const createCaseInput = z.strictObject({
  subjectId: z.uuid(),
  confirmedGoal: z.string().trim().min(1),
});
export const addCaseActorInput = z.strictObject({
  caseId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(["subject", "helper"]),
  shareScope: shareScopeSchema,
});

export const subjectSchema = createSubjectInput.extend({
  id: z.uuid(),
  createdBy: z.uuid(),
  createdAt: z.coerce.date(),
});
export const caseSchema = createCaseInput.extend({ id: z.uuid() });
export const actorSchema = addCaseActorInput.extend({ id: z.uuid(), createdAt: z.coerce.date() });
export const factSchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  type: z.string(),
  value: z.json(),
  documentId: z.uuid().nullable(),
  turnId: z.uuid().nullable(),
  sourceFactId: z.uuid().nullable(),
  source: z.record(z.string(), z.json()),
  confidence: z.number().min(0).max(1),
  confirmed: z.boolean(),
  createdAt: z.coerce.date(),
});

export type Subject = z.infer<typeof subjectSchema>;
export type SubjectCase = z.infer<typeof caseSchema>;
export type CaseActor = z.infer<typeof actorSchema>;
export type SubjectFact = z.infer<typeof factSchema>;
