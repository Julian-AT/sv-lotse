import type { WorkspaceFacility } from "@lotse/brain/workspace/schema";
import { expect, test } from "vitest";
import { distanceKm, filterFacilities } from "../src/features/workspace/facility-filter.ts";

const origin = { latitude: 48.1861406, longitude: 16.417604 };
// Coordinates and address from https://www.fsw.at/standorte; IDs are test-only.
const facility: WorkspaceFacility = {
  id: "test-facility",
  title: "FSW Beratung und Service-Center",
  type: "Pflegeberatung",
  region: "Wien",
  address: "Guglgasse 7–9, 1030 Wien",
  location: origin,
  openingHours: null,
  phone: null,
  email: null,
  url: null,
  bookingUrls: [],
  accessibility: null,
  services: [],
  sources: [],
  asOf: "2026-11-06",
  distanceKm: null,
};

test("FR-O2 filters by place and offer type while retaining entries with unknown distances", () => {
  const entries = [facility, { ...facility, id: "test-unknown", location: null }];
  expect(filterFacilities(entries, "  WIEN  ", "Pflegeberatung", origin, 1)).toHaveLength(2);
  expect(filterFacilities(entries, "", "other", origin, 1)).toHaveLength(0);
  expect(filterFacilities(entries, "Guglgasse", "", origin, 1)[0]?.distanceKm).toBe(0);
  expect(
    filterFacilities(entries, "", "", { latitude: 47, longitude: 15 }, 1).map((entry) => entry.id),
  ).toEqual(["test-unknown"]);
});

test("FR-O2 calculates straight-line distances without replacing unknown coordinates with zero", () => {
  expect(distanceKm(origin, origin)).toBe(0);
  expect(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(
    111.195,
    2,
  );
  expect(filterFacilities([facility], "", "", null, 50)[0]?.distanceKm).toBeNull();
});
