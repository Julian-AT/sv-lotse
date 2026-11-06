import { z } from "zod";
import { deadlineDate, type Reminder, reminderSource } from "../../deadlines/schema.ts";

export const reminderRecordSchema = z.strictObject({
  id: z.uuid(),
  caseId: z.uuid(),
  dueAt: deadlineDate,
  title: z.string(),
  sourceQuote: z.string(),
  source: reminderSource,
});
export function reminderRecord(reminder: Reminder): z.infer<typeof reminderRecordSchema> {
  return {
    id: reminder.id,
    caseId: reminder.caseId,
    dueAt: reminder.source.date ?? reminder.dueAt.toISOString(),
    title: reminder.source.title,
    sourceQuote: reminder.source.sourceQuote,
    source: reminder.source,
  };
}
