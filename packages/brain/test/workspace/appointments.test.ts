import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  exportAppointmentHold,
  prepareWorkspaceAppointment,
  rehearseWorkspaceAppointment,
} from "../../src/workspace/appointments.ts";
import { WorkspaceError, type WorkspaceSnapshot } from "../../src/workspace/schema.ts";

const caseId = randomUUID();
const source = {
  url: "https://auva.at/gesundheitseinrichtungen/rz-meidling/",
  quote: "RMV@auva.at",
  retrieved_at: "2026-11-06T01:35:29Z",
};
// Real official contact data; the administrative case and adversarial title are constructed test fixtures.
const snapshot: WorkspaceSnapshot = {
  cases: [],
  currentCase: {
    id: caseId,
    subjectId: randomUUID(),
    title: "Unterlagen vorbereiten",
    subjectName: "Testperson",
    status: "active",
    createdAt: "2026-11-06T01:35:29Z",
  },
  steps: [],
  events: [],
  documents: [],
  forms: [],
  benefits: [],
  selectedBenefitId: null,
  checklist: [],
  facilities: [
    {
      id: "test-facility",
      title: "AUVA Rehabilitationszentrum Meidling",
      type: "Rehabilitation",
      region: "Wien",
      address: "Köglergasse 2a, 1120 Wien",
      location: null,
      openingHours: null,
      phone: "+43 5 93 93-55000",
      email: "RMV@auva.at",
      url: source.url,
      bookingUrls: [],
      accessibility: null,
      services: [],
      sources: [source],
      asOf: "2026-11-06",
      distanceKm: null,
    },
  ],
};
const input = {
  caseId,
  facilityId: "test-facility",
  language: "de" as const,
  startAt: "2026-11-09T09:00:00+01:00",
  endAt: "2026-11-09T09:30:00+01:00",
};

test("FR-O3 prepares editable contact text using the goal and sourced channels without a booking", () => {
  const draft = prepareWorkspaceAppointment(snapshot, {
    caseId,
    facilityId: input.facilityId,
    language: "de",
  });
  expect(draft.callSheet).toContain(snapshot.currentCase?.title);
  expect(draft.callSheet).toContain("+43 5 93 93-55000");
  expect(draft.emailDraft).toContain("mögliche Termine");
  expect(draft.email).toBe("RMV@auva.at");
  expect(draft.bookingUrls).toEqual([]);
});

test("FR-O3 exports a tentative UTC calendar hold with stable identity and no booking side effects", () => {
  const now = new Date("2026-11-06T01:35:29Z");
  const ics = exportAppointmentHold(snapshot, input, now);
  expect(ics).toContain("DTSTART:20261109T080000Z\r\n");
  expect(ics).toContain("DTEND:20261109T083000Z\r\n");
  expect(ics).toContain("STATUS:TENTATIVE\r\n");
  expect(ics).toContain("nicht gebucht");
  expect(ics).not.toMatch(/^(METHOD|ATTENDEE|ORGANIZER|BEGIN:VALARM)/m);
  expect(ics).toBe(exportAppointmentHold(snapshot, input, now));
  expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
});

test("FR-O3 folds UTF-8 calendar lines and escapes text to prevent property injection", () => {
  const facility = snapshot.facilities[0];
  if (!facility) throw new Error("Missing test fixture");
  const adversarial = {
    ...snapshot,
    facilities: [
      {
        ...facility,
        title: `${"Ärztezentrum ".repeat(20)}\r\nATTENDEE:mailto:bad@example.com;Test,Ende\\`,
      },
    ],
  };
  const ics = exportAppointmentHold(adversarial, input, new Date());
  expect(ics.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75)).toBe(true);
  expect(ics).not.toContain("\r\nATTENDEE:");
  expect(ics.replace(/\r\n /g, "")).toContain(
    "\\nATTENDEE:mailto:bad@example.com\\;Test\\,Ende\\\\",
  );
});

test("FR-O3 rejects reversed times, foreign cases and unknown facilities", () => {
  expect(() =>
    exportAppointmentHold(snapshot, { ...input, endAt: input.startAt }, new Date()),
  ).toThrow(WorkspaceError);
  expect(() =>
    exportAppointmentHold(snapshot, { ...input, caseId: randomUUID() }, new Date()),
  ).toThrow(WorkspaceError);
  expect(() =>
    prepareWorkspaceAppointment(snapshot, { ...input, facilityId: "unknown" }),
  ).toThrow();
});

test("FR-O4 reuses the appointment.rehearse script with the authorized call sheet and selected language", () => {
  const preparationInput = { caseId, facilityId: input.facilityId, language: "en" as const };
  const rehearsal = rehearseWorkspaceAppointment(snapshot, preparationInput);
  expect(rehearsal.callSheet).toBe(
    prepareWorkspaceAppointment(snapshot, preparationInput).callSheet,
  );
  expect(rehearsal.script.filter((line) => line.role === "office")).toHaveLength(2);
  expect(rehearsal.notice).toContain("No real call");
  expect(() =>
    rehearseWorkspaceAppointment(snapshot, { ...preparationInput, caseId: randomUUID() }),
  ).toThrow(WorkspaceError);
});
