import { z } from "zod";
import { DeadlineError, type Reminder, reminderSchema } from "./schema.ts";

export type ReminderStatus = { overdue: Reminder[]; due: Reminder[]; upcoming: Reminder[] };

/** The caller chooses the horizon; no hidden lead time or machine-local clock. */
export function classifyReminders(
  reminders: readonly Reminder[],
  window: { now: Date; dueThrough: Date },
): ReminderStatus {
  const { now, dueThrough } = z.object({ now: z.date(), dueThrough: z.date() }).parse(window);
  if (dueThrough < now) throw new DeadlineError("invalid_window");
  const ordered = z
    .array(reminderSchema)
    .parse(reminders)
    .sort(
      (left, right) =>
        left.dueAt.getTime() - right.dueAt.getTime() || left.id.localeCompare(right.id),
    );
  const result: ReminderStatus = { overdue: [], due: [], upcoming: [] };
  for (const reminder of ordered) {
    if (reminder.dueAt < now) result.overdue.push(reminder);
    else if (reminder.dueAt <= dueThrough) result.due.push(reminder);
    else result.upcoming.push(reminder);
  }
  return result;
}
