import { DEADLINE_TIME_ZONE } from "./config.ts";
import { DeadlineError } from "./schema.ts";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEADLINE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function localDateTime(instant: Date): string {
  const parts = new Map(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const value = `${parts.get("year")?.padStart(4, "0")}${parts.get("month")}${parts.get("day")}T${parts.get("hour")}${parts.get("minute")}${parts.get("second")}`;
  if (!/^\d{8}T\d{6}$/.test(value)) throw new DeadlineError("invalid_reminder");
  return value;
}

export function offsetSeconds(instant: Date): number {
  const local = localDateTime(instant);
  const utc = Date.parse(
    `${local.slice(0, 4)}-${local.slice(4, 6)}-${local.slice(6, 8)}T${local.slice(9, 11)}:${local.slice(11, 13)}:${local.slice(13, 15)}Z`,
  );
  return (utc - Math.floor(instant.getTime() / 1000) * 1000) / 1000;
}

export function endOfViennaDate(date: string): Date {
  const nextMidnight = new Date(`${date}T00:00:00Z`);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  const midnight = new Date(nextMidnight.getTime() - offsetSeconds(nextMidnight) * 1000);
  return new Date(midnight.getTime() - 1);
}
