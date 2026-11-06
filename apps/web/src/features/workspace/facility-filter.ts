import type { WorkspaceFacility } from "@lotse/brain/workspace/schema";
import { EARTH_RADIUS_KM } from "./config.ts";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function distanceKm(from: Coordinates, to: Coordinates): number {
  const radians = Math.PI / 180;
  const latitude = (to.latitude - from.latitude) * radians;
  const longitude = (to.longitude - from.longitude) * radians;
  const arc =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(from.latitude * radians) *
      Math.cos(to.latitude * radians) *
      Math.sin(longitude / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(Math.max(0, 1 - arc)));
}

export function filterFacilities(
  facilities: readonly WorkspaceFacility[],
  query: string,
  type: string,
  origin: Coordinates | null,
  radiusKm: number,
): WorkspaceFacility[] {
  const search = query.trim().toLocaleLowerCase();
  return facilities
    .filter(
      (facility) =>
        (!type || facility.type === type) &&
        [facility.title, facility.region, facility.address, ...facility.services]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search),
    )
    .map((facility) => ({
      ...facility,
      distanceKm: origin && facility.location ? distanceKm(origin, facility.location) : null,
    }))
    .filter((facility) => facility.distanceKm === null || facility.distanceKm <= radiusKm)
    .sort(
      (left, right) =>
        (left.distanceKm ?? Number.POSITIVE_INFINITY) -
        (right.distanceKm ?? Number.POSITIVE_INFINITY),
    );
}
