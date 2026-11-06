import { createHash } from "node:crypto";
import { DIRECTORY_CONFIG } from "../config/index.ts";
import { directoryCopy } from "./copy.ts";
import type { AppointmentOption } from "./options.ts";

function calendarText(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code >= 32 && code !== 127) || [9, 10, 13].includes(code);
    })
    .join("")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function fold(line: string): string {
  const lines: string[] = [];
  let current = "";
  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > DIRECTORY_CONFIG.calendarLineOctets) {
      lines.push(current);
      current = " ";
    }
    current += character;
  }
  return [...lines, current].join("\r\n");
}

function utc(value: string | Date): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Tentative, transparent preference hold. Downloading never creates an event. */
export function appointmentCalendar(
  caseId: string,
  option: AppointmentOption,
  generatedAt: Date,
): string {
  if (!option.timeWindow) return "";
  const uid = createHash("sha256")
    .update(JSON.stringify([caseId, option.id, option.timeWindow]))
    .digest("hex");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${DIRECTORY_CONFIG.calendarProductId}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}@sv-ki-lotse`,
    `DTSTAMP:${utc(generatedAt)}`,
    `DTSTART:${utc(option.timeWindow.from)}`,
    `DTEND:${utc(option.timeWindow.to)}`,
    `SUMMARY:${calendarText(directoryCopy.de.hold)}`,
    `DESCRIPTION:${calendarText([option.title ?? "", directoryCopy.de.noBooking].join("\n"))}`,
    `LOCATION:${calendarText(option.address ? Object.values(option.address).join(", ") : "")}`,
    "STATUS:TENTATIVE",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n");
  return `${lines}\r\n`;
}
