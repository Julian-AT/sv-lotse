import { readdir, readFile } from "node:fs/promises";
import { beforeAll, expect, test } from "vitest";
import { parse } from "yaml";
import {
  type BenefitRecord,
  benefitCatalogQuerySchema,
  benefitRecordSchema,
  filterBenefitRecords,
} from "../../src/catalog/index.ts";

const catalog = new URL("../../../knowledge/catalog/", import.meta.url);
let records: BenefitRecord[];

beforeAll(async () => {
  const files = (await readdir(catalog)).filter((name) => name.endsWith(".yaml")).sort();
  records = await Promise.all(
    files.map(async (name) =>
      benefitRecordSchema.parse(parse(await readFile(new URL(name, catalog), "utf8"))),
    ),
  );
  expect(records.length).toBeGreaterThan(0);
});

test("PRD 7 catalog read without filters returns every loaded record", () => {
  expect(filterBenefitRecords(records, {})).toEqual(records);
});

test("PRD 7 catalog read filters by life situation case-insensitively", () => {
  const situation = records.flatMap((record) => record.life_situations)[0] ?? "";
  const result = filterBenefitRecords(records, { lifeSituation: situation.toLocaleUpperCase() });
  expect(result).toEqual(
    expect.arrayContaining(records.filter((record) => record.life_situations.includes(situation))),
  );
  expect(result.length).toBeLessThan(records.length);
  for (const record of result)
    expect(record.life_situations.map((item) => item.toLocaleLowerCase())).toContain(
      situation.toLocaleLowerCase(),
    );
});

test("PRD 7 catalog read filters by carrier", () => {
  const carrier = records.flatMap((record) => record.carriers)[0];
  expect(carrier).toBeDefined();
  if (!carrier) return;
  const result = filterBenefitRecords(records, { carrier });
  expect(result.length).toBeGreaterThan(0);
  expect(result.length).toBeLessThan(records.length);
  expect(result.every((record) => record.carriers.includes(carrier))).toBe(true);
});

test("PRD 7 catalog text search matches names ignoring case and accents", () => {
  const [target] = records;
  if (!target) return;
  const query = target.name_de.toLocaleLowerCase("de-AT").normalize("NFKD").replace(/\p{M}/gu, "");
  expect(filterBenefitRecords(records, { q: query })).toContain(target);
  expect(filterBenefitRecords(records, { q: "zzzz-no-catalog-match" })).toEqual([]);
});

test("PRD 7 catalog query rejects unknown carriers, extra parameters and blank text", () => {
  expect(benefitCatalogQuerySchema.safeParse({ carrier: "unknown" }).success).toBe(false);
  expect(benefitCatalogQuerySchema.safeParse({ subjectId: "caller" }).success).toBe(false);
  expect(benefitCatalogQuerySchema.safeParse({ q: "   " }).success).toBe(false);
  expect(benefitCatalogQuerySchema.parse({ q: " Pflege " })).toEqual({ q: "Pflege" });
});
