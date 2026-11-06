import { DEADLINE_TIME_ZONE } from "./config.ts";
import { DeadlineError } from "./schema.ts";
import { localDateTime, offsetSeconds } from "./time.ts";

type Transition = { at: number; from: number; to: number };
type TimeZoneDefinition = { lines: string[]; transitions: Transition[] };

export function utcDateTime(instant: Date): string {
  const value = instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  if (!/^\d{8}T\d{6}Z$/.test(value)) throw new DeadlineError("invalid_reminder");
  return value;
}

function offsetText(seconds: number): string {
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((absolute % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const remainder = absolute % 60;
  return `${seconds < 0 ? "-" : "+"}${hours}${minutes}${remainder ? remainder.toString().padStart(2, "0") : ""}`;
}

function observance(local: string, from: number, to: number): string[] {
  const kind = to > from ? "DAYLIGHT" : "STANDARD";
  return [
    `BEGIN:${kind}`,
    `DTSTART:${local}`,
    `TZOFFSETFROM:${offsetText(from)}`,
    `TZOFFSETTO:${offsetText(to)}`,
    `END:${kind}`,
  ];
}

function findTransition(start: number, end: number, from: number): Transition {
  let low = Math.floor(start / 1000);
  let high = Math.floor(end / 1000);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (offsetSeconds(new Date(middle * 1000)) === from) low = middle;
    else high = middle;
  }
  return { at: high * 1000, from, to: offsetSeconds(new Date(high * 1000)) };
}

/** Materialize the runtime IANA rules for each event year; do not guess future
 * EU DST rules or apply today's recurrence to historical dates. */
export function viennaTimeZone(instants: Date[]): TimeZoneDefinition {
  if (instants.length === 0) return { lines: [], transitions: [] };
  const years = [...new Set(instants.map((instant) => localDateTime(instant).slice(0, 4)))].sort();
  const lines = ["BEGIN:VTIMEZONE", `TZID:${DEADLINE_TIME_ZONE}`];
  const transitions: Transition[] = [];
  for (const year of years) {
    const start = Date.parse(`${year}-01-01T00:00:00Z`);
    const endDate = new Date(start);
    endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
    const end = endDate.getTime();
    let previous = start;
    let from = offsetSeconds(new Date(start));
    lines.push(...observance(`${year}0101T000000`, from, from));
    // Inspect each civil day's UTC boundary, then locate a change to the second.
    for (let at = start + 86_400_000; at <= end; at += 86_400_000) {
      const to = offsetSeconds(new Date(at));
      if (to !== from) {
        const transition = findTransition(previous, at, from);
        transitions.push(transition);
        const local = utcDateTime(new Date(transition.at + from * 1000)).slice(0, -1);
        lines.push(...observance(local, from, to));
      }
      previous = at;
      from = to;
    }
  }
  lines.push("END:VTIMEZONE");
  return { lines, transitions };
}

export function isRepeatedOccurrence(instant: Date, transitions: Transition[]): boolean {
  const time = instant.getTime();
  return transitions.some(
    ({ at, from, to }) => from > to && time >= at && time < at + (from - to) * 1000,
  );
}
