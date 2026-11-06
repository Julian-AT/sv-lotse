import { randomUUID } from "node:crypto";
import { exportRemindersCalendar, type Reminder } from "@lotse/brain/deadlines";
import { expect, test } from "vitest";
import { getProperty, parseCalendar, parseStart, textValue } from "./rfc5545.ts";

const generatedAt = new Date("2026-01-01T00:00:00Z");
function reminder(iso: string): Reminder {
  return {
    id: randomUUID(),
    caseId: randomUUID(),
    createdAt: generatedAt,
    dueAt: new Date(iso),
    source: {
      kind: "deadline",
      key: randomUUID(),
      title: "Unterlagen einreichen",
      sourceQuote: "Unterlagen bis zum genannten Termin einreichen.",
      provenance: {},
    },
  };
}

test("AC2 an RFC 5545 parser resolves Vienna winter, summer and both DST transitions", () => {
  const instants = [
    "2026-01-15T09:00:00Z",
    "2026-07-15T08:00:00Z",
    "2026-03-29T00:59:59Z",
    "2026-03-29T01:00:00Z",
    "2026-10-25T00:30:00Z",
    "2026-10-25T01:30:00Z",
    "2027-07-15T08:00:00Z",
  ];
  const reminders = instants.map(reminder);
  const calendar = parseCalendar(exportRemindersCalendar(reminders, generatedAt));
  const events = calendar.children.filter((child) => child.name === "VEVENT");
  const observed = events.map((event) => parseStart(calendar, event));
  expect(observed).toEqual(instants.map((iso) => new Date(iso)));
  expect(getProperty(events[0] ?? calendar, "DTSTART").parameters.get("TZID")).toBe(
    "Europe/Vienna",
  );
  expect(getProperty(events[1] ?? calendar, "DTSTART").value).toBe("20260715T100000");
  // RFC 5545 resolves repeated local times to the first occurrence; the second
  // must be serialized as an unambiguous UTC instant instead.
  expect(getProperty(events[5] ?? calendar, "DTSTART").value).toBe("20261025T013000Z");
});

test("AC2 unfolds UTF-8 lines and round-trips escaped source quotes without injecting events", () => {
  const entry = reminder("2026-07-15T08:00:00Z");
  entry.source.title = "Änderung, Unterlagen; Rückfrage 🗓️ ".repeat(8);
  entry.source.sourceQuote =
    "Frist, Rückfrage; Pfad \\A\nEND:VEVENT\nBEGIN:VEVENT\nWeitere Unterlagen.";
  const output = exportRemindersCalendar([entry], generatedAt);
  for (const line of output.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  const calendar = parseCalendar(output);
  const events = calendar.children.filter((child) => child.name === "VEVENT");
  expect(events).toHaveLength(1);
  const [event] = events;
  if (!event) throw new Error("Missing parsed event");
  expect(textValue(getProperty(event, "SUMMARY").value)).toBe(entry.source.title);
  expect(textValue(getProperty(event, "DESCRIPTION").value)).toBe(entry.source.sourceQuote);
});

test("keeps UIDs stable when a deadline is edited or exported again", () => {
  const original = reminder("2026-07-15T08:00:00Z");
  const revised = { ...original, dueAt: new Date("2026-07-16T08:00:00Z") };
  const uid = (entry: Reminder, stamp: Date) => {
    const calendar = parseCalendar(exportRemindersCalendar([entry], stamp));
    const event = calendar.children.find((child) => child.name === "VEVENT");
    if (!event) throw new Error("Missing parsed event");
    return getProperty(event, "UID").value;
  };
  expect(uid(revised, new Date("2026-02-01T00:00:00Z"))).toBe(uid(original, generatedAt));
});

test("exports date-only obligations as all-day dates without shifting the day at DST", () => {
  const entry = reminder("2026-03-29T21:59:59.999Z");
  entry.source.date = "2026-03-29";
  const calendar = parseCalendar(exportRemindersCalendar([entry], generatedAt));
  const event = calendar.children.find((child) => child.name === "VEVENT");
  if (!event) throw new Error("Missing parsed event");
  expect(parseStart(calendar, event)).toBe("20260329");
});

test("rejects duplicate UIDs, invalid control characters and inconsistent date-only reminders", () => {
  const entry = reminder("2026-07-15T08:00:00Z");
  expect(() => exportRemindersCalendar([entry, entry], generatedAt)).toThrow("invalid_reminder");
  expect(() =>
    exportRemindersCalendar(
      [{ ...entry, source: { ...entry.source, title: String.fromCharCode(0) } }],
      generatedAt,
    ),
  ).toThrow("invalid_reminder");
  expect(() =>
    exportRemindersCalendar(
      [{ ...entry, source: { ...entry.source, date: "2026-07-16" } }],
      generatedAt,
    ),
  ).toThrow("invalid_reminder");
  expect(parseCalendar(exportRemindersCalendar([], generatedAt)).children).toEqual([]);
});
