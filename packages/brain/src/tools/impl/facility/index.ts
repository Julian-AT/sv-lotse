import { resolvePlace } from "../../../directory/geo.ts";
import {
  facilityRecords,
  openingHours,
  recordAddress,
  recordSources,
} from "../../../directory/records.ts";
import { facilityFiltersSchema, nearbyFacilities } from "../../../directory/search.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "facility.search": async (raw) => {
      const input = contracts["facility.search"].input.parse(raw);
      const db = requireDatabase(deps);
      const origin = await resolvePlace(input.near);
      const filters = facilityFiltersSchema.parse(input.filters);
      const matches = nearbyFacilities(
        await facilityRecords(db),
        input.type,
        origin,
        input.radiusKm,
        filters,
      );
      return matches.map(({ record, location, distanceKm }) => ({
        id: record.id,
        title: record.name_de,
        address: recordAddress(record),
        location,
        distanceKm,
        distanceKind: "straight_line_approximate",
        openingHours: openingHours(record),
        sources: recordSources(record),
      }));
    },
  };
}
