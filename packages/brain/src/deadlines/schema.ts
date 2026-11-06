import { z } from "zod";

export const deadlineDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const text = z.string().refine((value) => value.trim().length > 0);
export const deadlineValue = z.object({ title: text, dueAt: deadlineDate });
export const obligationInput = z.object({
  facts: z.array(
    z.object({
      id: z.uuid(),
      confirmed: z.boolean(),
      value: z.unknown(),
      source: z.record(z.string(), z.json()),
    }),
  ),
  steps: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(["pending", "in_progress", "blocked", "completed"]),
      dueAt: z.date().nullable(),
      title: text,
      sourceQuote: text,
    }),
  ),
});

export const reminderSource = z.object({
  kind: z.literal("deadline"),
  key: text,
  title: text,
  sourceQuote: text,
  date: z.iso.date().optional(),
  provenance: z.record(z.string(), z.json()),
});
export const reminderSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  dueAt: z.date(),
  createdAt: z.date(),
  source: reminderSource,
});
export type Reminder = z.infer<typeof reminderSchema>;
export type Obligation = { key: string; dueAt: Date; source: z.infer<typeof reminderSource> };

export class DeadlineError extends Error {
  constructor(
    public readonly code:
      | "case_not_found"
      | "invalid_reminder"
      | "invalid_window"
      | "persistence_failed",
  ) {
    super(code);
    this.name = "DeadlineError";
  }
}
