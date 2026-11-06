import { z } from "zod";
import { DIRECTORY_CONFIG } from "../config/index.ts";
import { distanceKm, normalized } from "./geo.ts";
import type { DirectoryRecord, Location, TimeWindow } from "./schema.ts";

export const facilityFiltersSchema = z.strictObject({
  region: z.string().optional(),
  carrier: z.string().optional(),
  language: z.string().optional(),
  accessibility: z.array(z.string()).optional(),
  services: z.array(z.string()).optional(),
});

export type FacilityFilters = z.infer<typeof facilityFiltersSchema>;
export type LocatedFacility = { record: DirectoryRecord; location: Location; distanceKm: number };
export function matchesFilters(record: DirectoryRecord, filters: FacilityFilters): boolean {
  if (filters.region && normalized(record.region ?? "") !== normalized(filters.region))
    return false;
  if (filters.carrier && !record.carriers?.includes(filters.carrier)) return false;
  if (
    filters.language &&
    record.languages &&
    !record.languages.some(
      (language) => normalized(language) === normalized(filters.language ?? ""),
    )
  )
    return false;
  if (
    filters.accessibility?.length &&
    record.accessibility_features &&
    !filters.accessibility.every((need) =>
      record.accessibility_features?.some((feature) => normalized(feature) === normalized(need)),
    )
  )
    return false;
  return (
    !filters.services?.length ||
    filters.services.every((service) =>
      record.services?.some((offer) => normalized(offer) === normalized(service)),
    )
  );
}

export function nearbyFacilities(
  records: readonly DirectoryRecord[],
  type: string | undefined,
  origin: Location,
  radiusKm: number,
  filters: FacilityFilters,
): LocatedFacility[] {
  const results: LocatedFacility[] = [];
  for (const record of records) {
    if (type && normalized(record.type ?? "") !== normalized(type)) continue;
    if (!record.location || !matchesFilters(record, filters)) continue;
    const location = { lat: record.location.latitude, lon: record.location.longitude };
    const distance = distanceKm(origin, location);
    if (distance <= radiusKm) results.push({ record, location, distanceKm: distance });
  }
  return results.sort(
    (a, b) => a.distanceKm - b.distanceKm || a.record.id.localeCompare(b.record.id),
  );
}

const contactTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DIRECTORY_CONFIG.timeZone,
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localParts(date: Date): { day: string; minute: number } {
  const parts = contactTimeFormatter.formatToParts(date);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: value("weekday").toLowerCase(),
    minute: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function publishedHoursMatch(hours: string | undefined, minute: number): boolean | null {
  if (!hours) return null;
  const intervals = [...hours.matchAll(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/g)];
  if (!intervals.length) return null;
  return intervals.some(
    (interval) =>
      minute >= Number(interval[1]) * 60 + Number(interval[2]) &&
      minute < Number(interval[3]) * 60 + Number(interval[4]),
  );
}

/** Opening hours are contact hours, never a provider's slot availability.
 * Walking actual minute boundaries handles skipped and repeated Vienna hours. */
export function openingWindowMatch(record: DirectoryRecord, window: TimeWindow): boolean | null {
  // Free-text published hours are displayed verbatim, not inferred as a daily schedule.
  if (!record.opening_hours || typeof record.opening_hours === "string") return null;
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  if (to - from >= DIRECTORY_CONFIG.weekMs) return null;
  let unknown = false;
  for (let cursor = from; cursor < to; cursor = (Math.floor(cursor / 60000) + 1) * 60000) {
    const local = localParts(new Date(cursor));
    const matches = publishedHoursMatch(record.opening_hours[local.day], local.minute);
    if (matches === true) return true;
    if (matches === null) unknown = true;
  }
  return unknown ? null : false;
}
