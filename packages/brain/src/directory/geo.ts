import { readFile } from "node:fs/promises";
import { z } from "zod";
import { DIRECTORY_CONFIG } from "../config/index.ts";
import { DirectoryError, type Location, locationSchema } from "./schema.ts";

const placeSchema = locationSchema.extend({
  places: z.array(z.string()).min(1),
  regions: z.array(z.string()),
});

const postcodeSchema = z.object({
  postcodes: z.record(z.string().regex(/^\d{4}$/), placeSchema),
});

let postcodeData: Promise<z.infer<typeof postcodeSchema>> | undefined;
async function table(): Promise<z.infer<typeof postcodeSchema>> {
  postcodeData ??= readFile(
    new URL("../../../knowledge/data/postcodes-at.json", import.meta.url),
    "utf8",
  ).then((text) => postcodeSchema.parse(JSON.parse(text)));
  return postcodeData;
}

export function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("de-AT").trim();
}

function centroid(places: readonly Location[]): Location {
  return {
    lat: places.reduce((sum, place) => sum + place.lat, 0) / places.length,
    lon: places.reduce((sum, place) => sum + place.lon, 0) / places.length,
  };
}

/** Locality centroids deliberately provide approximate, straight-line distances. */
export async function resolvePlace(near: string | Location): Promise<Location> {
  if (typeof near !== "string") return locationSchema.parse(near);
  const { postcodes } = await table();
  const postalCode = /^(?:AT[- ]?)?(\d{4})(?:\s+.*)?$/i.exec(near.trim())?.[1];
  if (postalCode) {
    const place = postcodes[postalCode];
    if (!place) throw new DirectoryError("PLACE_NOT_FOUND");
    return { lat: place.lat, lon: place.lon };
  }
  const matches = Object.values(postcodes).filter((place) =>
    place.places.some(
      (name) =>
        normalized(name) === normalized(near) ||
        normalized(name.split(",")[0] ?? "") === normalized(near),
    ),
  );
  if (!matches.length) throw new DirectoryError("PLACE_NOT_FOUND");
  const first = matches[0];
  if (
    !first ||
    matches.some((place) => distanceKm(place, first) > DIRECTORY_CONFIG.ambiguousPlaceRadiusKm)
  )
    throw new DirectoryError("PLACE_AMBIGUOUS");
  return centroid(matches);
}

export function distanceKm(from: Location, to: Location): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const a =
    Math.sin(radians(to.lat - from.lat) / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(to.lat)) *
      Math.sin(radians(to.lon - from.lon) / 2) ** 2;
  return (
    DIRECTORY_CONFIG.earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  );
}
