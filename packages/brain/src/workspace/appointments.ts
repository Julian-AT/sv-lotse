import { createHash } from "node:crypto";
import type { z } from "zod";
import { CALENDAR_LINE_OCTETS, CALENDAR_PRODUCT_ID } from "../deadlines/config.ts";
import { callRehearsal } from "../directory/prepare.ts";
import { appointmentCopy } from "./copy.ts";
import {
  type AppointmentPreparation,
  type AppointmentRehearsal,
  appointmentCalendarInput,
  appointmentPreparationInput,
  WorkspaceError,
  type WorkspaceFacility,
  type WorkspaceSnapshot,
} from "./schema.ts";

function facilityFor(snapshot: WorkspaceSnapshot, id: string): WorkspaceFacility {
  const facility = snapshot.facilities.find((entry) => entry.id === id);
  if (!snapshot.currentCase) throw new WorkspaceError("ACCESS_DENIED");
  if (!facility) throw new WorkspaceError("NOT_FOUND");
  return facility;
}

/** Drafts contain the confirmed administrative goal only, never inferred medical details. */
export function prepareWorkspaceAppointment(
  snapshot: WorkspaceSnapshot,
  raw: z.input<typeof appointmentPreparationInput>,
): AppointmentPreparation {
  const input = appointmentPreparationInput.parse(raw);
  if (snapshot.currentCase?.id !== input.caseId) throw new WorkspaceError("ACCESS_DENIED");
  const facility = facilityFor(snapshot, input.facilityId);
  const copy = appointmentCopy[input.language];
  const goal = snapshot.currentCase.title;
  const checklist = snapshot.checklist
    .map((item) => `${item.title}${item.where ? ` (${item.where})` : ""}`)
    .join("\n");
  return {
    callSheet: [
      copy.call,
      facility.title,
      facility.phone,
      facility.address,
      `${copy.goal}: ${goal}`,
      copy.questions,
      copy.documents,
      checklist || copy.unknown,
    ]
      .filter(Boolean)
      .join("\n\n"),
    emailSubject: `${copy.subject}: ${facility.title}`,
    emailDraft: `${copy.greeting}\n\n${copy.request}\n${goal}\n\n${copy.closing}`,
    email: facility.email,
    phone: facility.phone,
    bookingUrls: facility.bookingUrls,
  };
}

function escapeCalendarText(value: string): string {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127)
      throw new WorkspaceError("INVALID_INPUT");
  }
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldCalendarLine(value: string): string {
  const lines: string[] = [];
  let current = "";
  for (const character of value) {
    if (Buffer.byteLength(current + character, "utf8") > CALENDAR_LINE_OCTETS) {
      lines.push(current);
      current = " ";
    }
    current += character;
  }
  return [...lines, current].join("\r\n");
}

function timestamp(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** A tentative local hold only: no METHOD, attendees, alarms or automatic calendar mutation. */
export function exportAppointmentHold(
  snapshot: WorkspaceSnapshot,
  raw: z.input<typeof appointmentCalendarInput>,
  generatedAt: Date,
): string {
  const input = appointmentCalendarInput.parse(raw);
  if (snapshot.currentCase?.id !== input.caseId) throw new WorkspaceError("ACCESS_DENIED");
  if (new Date(input.endAt) <= new Date(input.startAt)) throw new WorkspaceError("INVALID_INPUT");
  const facility = facilityFor(snapshot, input.facilityId);
  const copy = appointmentCopy[input.language];
  const uid = createHash("sha256")
    .update(JSON.stringify([input.caseId, facility.id, input.startAt]))
    .digest("hex");
  return `${[
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${CALENDAR_PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}@sv-ki-lotse`,
    `DTSTAMP:${timestamp(generatedAt.toISOString())}`,
    `DTSTART:${timestamp(input.startAt)}`,
    `DTEND:${timestamp(input.endAt)}`,
    `SUMMARY:${escapeCalendarText(`${copy.hold}: ${facility.title}`)}`,
    `LOCATION:${escapeCalendarText(facility.address)}`,
    `DESCRIPTION:${escapeCalendarText(copy.notice)}`,
    "STATUS:TENTATIVE",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(foldCalendarLine)
    .join("\r\n")}\r\n`;
}

/** Same script as appointment.rehearse, using the authorized workspace call sheet. */
export function rehearseWorkspaceAppointment(
  snapshot: WorkspaceSnapshot,
  raw: z.input<typeof appointmentPreparationInput>,
): AppointmentRehearsal {
  const input = appointmentPreparationInput.parse(raw);
  const preparation = prepareWorkspaceAppointment(snapshot, input);
  return callRehearsal(preparation.callSheet, undefined, input.language);
}
