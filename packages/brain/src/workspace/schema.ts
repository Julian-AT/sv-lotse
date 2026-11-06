import { z } from "zod";

export const workspaceLanguage = z.enum(["de", "en"]).default("de");
export const workspaceSourceSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  quote: z.string().min(1),
  retrieved_at: z.iso.datetime({ offset: true }),
});
export const workspaceStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["pending", "current", "completed", "prepared"]),
  owner: z.enum(["user", "pilot", "office"]),
  dueDate: z.string().optional(),
  blocked: z.boolean().default(false),
  initiatedBy: z.enum(["user", "pilot", "office"]).optional(),
  artifacts: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        text: z.string(),
        sources: z.array(workspaceSourceSchema),
      }),
    )
    .optional(),
});
export type WorkspaceStep = z.infer<typeof workspaceStepSchema>;
export const workspaceCaseSchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  title: z.string(),
  status: z.enum(["active", "paused", "completed", "archived"]),
  createdAt: z.iso.datetime({ offset: true }),
});
export type WorkspaceCase = z.infer<typeof workspaceCaseSchema>;
export const workspaceDocumentSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  ocrStatus: z.enum(["pending", "processing", "completed", "failed"]),
  createdAt: z.iso.datetime({ offset: true }),
});
export const workspaceChecklistSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["have", "missing", "obtainable"]),
  where: z.string(),
  source: workspaceSourceSchema,
});
export type WorkspaceChecklistItem = z.infer<typeof workspaceChecklistSchema>;
export const workspaceFacilitySchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  region: z.string().nullable(),
  address: z.string(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
  openingHours: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.email().nullable(),
  url: z.url({ protocol: /^https?$/ }).nullable(),
  bookingUrls: z.array(z.url({ protocol: /^https?$/ })),
  accessibility: z.string().nullable(),
  services: z.array(z.string()),
  sources: z.array(workspaceSourceSchema),
  asOf: z.string(),
  distanceKm: z.number().nonnegative().nullable(),
});
export type WorkspaceFacility = z.infer<typeof workspaceFacilitySchema>;
export const workspaceSnapshotSchema = z.object({
  cases: z.array(workspaceCaseSchema),
  currentCase: workspaceCaseSchema.nullable(),
  steps: z.array(workspaceStepSchema),
  events: z.array(
    z.object({
      id: z.string(),
      kind: z.enum([
        "goal_confirmed",
        "step_created",
        "step_completed",
        "reminder_created",
        "artefact_ready",
      ]),
      stepId: z.string().nullable(),
    }),
  ),
  documents: z.array(workspaceDocumentSchema),
  forms: z.array(z.object({ id: z.uuid(), title: z.string() })).default([]),
  benefits: z.array(z.object({ id: z.string(), title: z.string() })),
  selectedBenefitId: z.string().nullable(),
  checklist: z.array(workspaceChecklistSchema),
  facilities: z.array(workspaceFacilitySchema),
});
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export const workspaceQuerySchema = z.strictObject({
  caseId: z.uuid().optional(),
  benefitId: z.string().min(1).optional(),
});
export const appointmentPreparationInput = z.strictObject({
  caseId: z.uuid(),
  benefitId: z.string().min(1).optional(),
  facilityId: z.string().min(1),
  language: workspaceLanguage,
});
export const appointmentCalendarInput = appointmentPreparationInput.extend({
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
});
export const appointmentPreparationSchema = z.object({
  callSheet: z.string(),
  emailSubject: z.string(),
  emailDraft: z.string(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
  bookingUrls: z.array(z.url({ protocol: /^https?$/ })),
});
export const appointmentRehearsalSchema = z.object({
  notice: z.string().min(1),
  callSheet: z.string(),
  script: z.array(z.object({ role: z.enum(["caller", "office"]), text: z.string().min(1) })).min(1),
});
export type AppointmentRehearsal = z.infer<typeof appointmentRehearsalSchema>;
export type AppointmentPreparation = z.infer<typeof appointmentPreparationSchema>;

export class WorkspaceError extends Error {
  constructor(
    readonly code:
      | "ACCESS_DENIED"
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "CASE_ACCESS_DENIED"
      | "RESOURCE_NOT_FOUND",
  ) {
    super(code);
    this.name = "WorkspaceError";
  }
}
