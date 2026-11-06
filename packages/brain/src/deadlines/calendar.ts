import { z } from "zod";
import { CALENDAR_LINE_OCTETS, CALENDAR_PRODUCT_ID, DEADLINE_TIME_ZONE } from "./config.ts";
import { DeadlineError, type Reminder, reminderSchema } from "./schema.ts";
import { endOfViennaDate, localDateTime } from "./time.ts";
import { isRepeatedOccurrence, utcDateTime, viennaTimeZone } from "./timezone.ts";

function escapeText(text: string): string {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127) {
      throw new DeadlineError("invalid_reminder");
    }
  }
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (octets + size > CALENDAR_LINE_OCTETS) {
      parts.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

function eventStart(reminder: Reminder, repeated: boolean): string {
  if (reminder.source.date) {
    if (endOfViennaDate(reminder.source.date).getTime() !== reminder.dueAt.getTime()) {
      throw new DeadlineError("invalid_reminder");
    }
    return `DTSTART;VALUE=DATE:${reminder.source.date.replaceAll("-", "")}`;
  }
  return repeated
    ? `DTSTART:${utcDateTime(reminder.dueAt)}`
    : `DTSTART;TZID=${DEADLINE_TIME_ZONE}:${localDateTime(reminder.dueAt)}`;
}

/** RFC 5545 VEVENT download. DATE obligations stay all-day; timed obligations
 * use Vienna observances, with UTC for the second occurrence of a repeated hour.
 * No METHOD, alarm or duration: exporting does not schedule an action or notification.
 */
export function exportRemindersCalendar(reminders: readonly Reminder[], generatedAt: Date): string {
  const entries = z.array(reminderSchema).parse(reminders);
  const stamp = utcDateTime(z.date().parse(generatedAt));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new DeadlineError("invalid_reminder");
  }
  const zone = viennaTimeZone(
    entries.filter((entry) => !entry.source.date).map((entry) => entry.dueAt),
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${CALENDAR_PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    `X-WR-TIMEZONE:${DEADLINE_TIME_ZONE}`,
    ...zone.lines,
  ];
  for (const reminder of entries) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${reminder.id}@sv-ki-lotse`,
      `DTSTAMP:${stamp}`,
      eventStart(reminder, isRepeatedOccurrence(reminder.dueAt, zone.transitions)),
      `SUMMARY:${escapeText(reminder.source.title)}`,
      `DESCRIPTION:${escapeText(reminder.source.sourceQuote)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
