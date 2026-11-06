import type { DatabaseClient } from "@lotse/db";
import { benefits } from "@lotse/db/schema";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { CATALOG_QUERY_MAX_LENGTH } from "../config/index.ts";
import { normalized } from "../engine/catalog.ts";
import { benefitRecordSchema } from "../tools/contracts/records.ts";

export type BenefitRecord = z.infer<typeof benefitRecordSchema>;
export { benefitRecordSchema };

const filterText = z.string().trim().min(1).max(CATALOG_QUERY_MAX_LENGTH);
/** Read filters for catalog records; every filter is optional and they combine with AND. */
export const benefitCatalogQuerySchema = z.strictObject({
  lifeSituation: filterText.optional(),
  carrier: benefitRecordSchema.shape.carriers.element.optional(),
  q: filterText.optional(),
});
export type BenefitCatalogQuery = z.infer<typeof benefitCatalogQuerySchema>;

/** Every loaded catalog record, validated against the record contract, in title order. */
export async function readBenefitRecords(db: DatabaseClient): Promise<BenefitRecord[]> {
  const rows = await db
    .select({ record: benefits.record })
    .from(benefits)
    .orderBy(asc(benefits.title), asc(benefits.key));
  return rows.map((row) => benefitRecordSchema.parse(row.record));
}

function matchesText(record: BenefitRecord, query: string): boolean {
  const text = normalized(
    [record.id, record.name_de, record.name_simple, ...record.life_situations].join(" "),
  );
  return normalized(query)
    .split(/\s+/u)
    .filter(Boolean)
    .every((term) => text.includes(term));
}

export function filterBenefitRecords(
  records: readonly BenefitRecord[],
  query: BenefitCatalogQuery,
): BenefitRecord[] {
  const situation = query.lifeSituation === undefined ? undefined : normalized(query.lifeSituation);
  return records.filter(
    (record) =>
      (situation === undefined ||
        record.life_situations.some((item) => normalized(item) === situation)) &&
      (query.carrier === undefined || record.carriers.includes(query.carrier)) &&
      (query.q === undefined || matchesText(record, query.q)),
  );
}

export async function listCatalogBenefits(
  db: DatabaseClient,
  query: BenefitCatalogQuery,
): Promise<BenefitRecord[]> {
  return filterBenefitRecords(await readBenefitRecords(db), query);
}
