import type { DatabaseClient } from "@lotse/db";
import type { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import type { contracts } from "../tools/contracts/index.ts";
import { confirmedFacts } from "./context.ts";
import { normalized, resolvePlace } from "./geo.ts";
import { type AppointmentOption, catalogOptions, directoryOptions } from "./options.ts";
import { directoryRecord, facilityRecords } from "./records.ts";
import { DirectoryError, type DirectoryRecord, type Location } from "./schema.ts";
import { matchesFilters, nearbyFacilities, openingWindowMatch } from "./search.ts";

type SearchInput = z.infer<(typeof contracts)["appointment.search"]["input"]>;
async function searchRecords(
  db: DatabaseClient,
  ids: string[] | undefined,
): Promise<DirectoryRecord[]> {
  if (!ids) return facilityRecords(db);
  return (await Promise.all(ids.map((id) => directoryRecord(db, id)))).filter(
    (record) => record !== undefined,
  );
}

async function searchOrigin(
  db: DatabaseClient,
  input: SearchInput,
  context: RuntimeContext,
): Promise<Location | undefined> {
  if (input.preferences.near) return resolvePlace(input.preferences.near);
  const stored = await confirmedFacts(db, context);
  const postalFacts = stored.filter(
    (fact) => fact.type.endsWith("postal_code") && typeof fact.value === "string",
  );
  const values = [...new Set(postalFacts.map((fact) => String(fact.value)))];
  const code = values.length === 1 ? values[0] : undefined;
  if (code) return resolvePlace(code);
  if (input.benefitId) return undefined;
  throw new DirectoryError("PLACE_NOT_FOUND");
}

async function matchOptions(
  record: DirectoryRecord,
  preferences: SearchInput["preferences"],
  position?: { location: Location; distanceKm: number },
): Promise<AppointmentOption[]> {
  const hours = openingWindowMatch(record, preferences.timeWindow);
  if (hours === false) return [];
  const unknown: string[] = [];
  if (!position) unknown.push("distance");
  if (hours === null) unknown.push("timeWindow");
  if (!record.languages) unknown.push("language");
  if (preferences.accessibility.length && !record.accessibility_features)
    unknown.push("accessibility");
  return (await directoryOptions(record, preferences.timeWindow)).map((option) => ({
    ...option,
    ...position,
    unverifiedPreferences: unknown,
  }));
}

export async function searchAppointmentOptions(
  db: DatabaseClient,
  input: SearchInput,
  context: RuntimeContext,
): Promise<AppointmentOption[]> {
  const preferences = input.preferences;
  const candidates = input.benefitId
    ? await catalogOptions(db, input.benefitId, preferences.timeWindow)
    : [];
  const records = (await searchRecords(db, input.facilityIds)).filter(
    (record) => !input.type || normalized(record.type ?? "") === normalized(input.type),
  );
  const filters = { language: preferences.language, accessibility: preferences.accessibility };
  // Remote contacts have no physical distance; only explicitly marked records qualify.
  const remote = records.filter((record) => record.remote && matchesFilters(record, filters));
  for (const record of remote) candidates.push(...(await matchOptions(record, preferences)));
  const physical = records.filter((record) => !record.remote);
  const origin =
    input.facilityIds?.length === 0 || (candidates.length > 0 && physical.length === 0)
      ? undefined
      : await searchOrigin(db, input, context);
  if (origin) {
    const matches = nearbyFacilities(
      physical,
      input.type,
      origin,
      preferences.maxDistanceKm,
      filters,
    );
    for (const match of matches)
      candidates.push(
        ...(await matchOptions(match.record, preferences, {
          location: match.location,
          distanceKm: match.distanceKm,
        })),
      );
  }
  return candidates.map((option) => ({
    ...option,
    requestedPreferences: {
      language: preferences.language,
      accessibility: preferences.accessibility,
    },
  }));
}
