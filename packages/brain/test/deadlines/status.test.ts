import { randomUUID } from "node:crypto";
import { classifyReminders, type Reminder } from "@lotse/brain/deadlines";
import { expect, test } from "vitest";

function reminder(iso: string): Reminder {
  return {
    id: randomUUID(),
    caseId: randomUUID(),
    createdAt: new Date("2026-01-01Z"),
    dueAt: new Date(iso),
    source: {
      kind: "deadline",
      key: randomUUID(),
      title: "Einreichen",
      sourceQuote: "Unterlagen einreichen.",
      provenance: {},
    },
  };
}

test("FR-K2 classifies overdue, due and upcoming using explicit inclusive boundaries", () => {
  const overdue = reminder("2026-03-29T06:59:59Z");
  const dueNow = reminder("2026-03-29T07:00:00Z");
  const dueEnd = reminder("2026-03-29T21:59:59.999Z");
  const upcoming = reminder("2026-03-29T22:00:00Z");
  expect(
    classifyReminders([upcoming, dueEnd, overdue, dueNow], {
      now: new Date("2026-03-29T07:00:00Z"),
      dueThrough: new Date("2026-03-29T21:59:59.999Z"),
    }),
  ).toEqual({ overdue: [overdue], due: [dueNow, dueEnd], upcoming: [upcoming] });
});

test("rejects invalid clocks and reversed due windows", () => {
  expect(() =>
    classifyReminders([], { now: new Date("invalid"), dueThrough: new Date() }),
  ).toThrow();
  expect(() =>
    classifyReminders([], { now: new Date("2026-04-02Z"), dueThrough: new Date("2026-04-01Z") }),
  ).toThrow("invalid_window");
});
