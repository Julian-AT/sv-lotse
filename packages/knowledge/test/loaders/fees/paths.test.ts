import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { loadFeeSchedules } from "../../../src/loaders/fees/index.ts";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const svboxRoot = resolve(repositoryRoot, "data/svbox");

afterEach(() => {
  vi.unstubAllEnvs();
});

test.each([
  ["unset", undefined],
  ["repository-relative", "data/svbox"],
  ["absolute", svboxRoot],
] as const)(
  "FR-M2 loads real fee schedules with %s SVBOX_DIR",
  async (_label, directory) => {
    vi.stubEnv("SVBOX_DIR", directory);
    const schedules = await loadFeeSchedules();
    expect(schedules.map((schedule) => schedule.kind)).toEqual(["styria", "dental"]);
    expect(schedules.every((schedule) => schedule.positions.length > 0)).toBe(true);
  },
  30000,
);
