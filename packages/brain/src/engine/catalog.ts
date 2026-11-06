import { lifeSituationKey, lifeSituationTerms } from "@lotse/knowledge/life-situations";
import { z } from "zod";
import {
  CATALOG_LIFE_SITUATION_WEIGHT,
  CATALOG_MAX_CANDIDATES,
  CATALOG_MIN_TOKEN_LENGTH,
} from "../config/index.ts";
import type { benefitRecordSchema } from "../tools/contracts/records.ts";
import { evaluateCondition } from "./conditions.ts";
import type { JsonValue } from "./schema.ts";

export type BenefitRecord = z.infer<typeof benefitRecordSchema>;
export const findBenefitsInput = z.object({
  lifeSituation: z.string().optional(),
  goalText: z.string(),
  subject: z.object({
    ageBand: z.string().optional(),
    carrier: z.string().optional(),
    region: z.string().optional(),
    status: z.string().optional(),
  }),
});
type FindInput = z.infer<typeof findBenefitsInput>;
/** Case-, accent- and ß-insensitive form used for every catalog text comparison. */
export function normalized(value: string): string {
  return value
    .toLocaleLowerCase("de-AT")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replaceAll("ß", "ss");
}
function words(value: string): string[] {
  return normalized(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= CATALOG_MIN_TOKEN_LENGTH);
}
function score(record: BenefitRecord, input: FindInput): number {
  const terms = words(
    [
      record.name_de,
      record.name_simple,
      ...record.life_situations.flatMap(lifeSituationTerms),
    ].join(" "),
  );
  const query = [...new Set(words(`${input.lifeSituation ?? ""} ${input.goalText}`))];
  const overlap = query.filter((word) =>
    terms.some((term) => term.startsWith(word) || word.startsWith(term)),
  ).length;
  const requested = input.lifeSituation ?? "";
  // A label or earlier spelling of a vocabulary key counts as that key.
  const requestedKey = lifeSituationKey(requested);
  const situation = record.life_situations.some(
    (item) =>
      normalized(item) === normalized(requested) ||
      (requestedKey !== undefined && lifeSituationKey(item) === requestedKey),
  );
  return overlap + (situation ? CATALOG_LIFE_SITUATION_WEIGHT : 0);
}
export function criterionStatus(
  condition: string | undefined,
  values: Readonly<Record<string, JsonValue>>,
): "met" | "unknown" | "not_met" {
  const result = evaluateCondition(condition, values);
  return result === undefined ? "unknown" : result ? "met" : "not_met";
}
export function findBenefits(
  records: readonly BenefitRecord[],
  input: FindInput,
  facts: Readonly<Record<string, JsonValue>> = {},
): {
  id: string;
  title: string;
  description: string;
  criteria: {
    id: string;
    status: "met" | "unknown" | "not_met";
    sources: { url: string; quote: string; asOf: string }[];
  }[];
  sources: { url: string; quote: string; asOf: string }[];
}[] {
  const values: Record<string, JsonValue> = { ...facts };
  for (const [key, value] of Object.entries(input.subject))
    if (value !== undefined) values[key] = value;
  return records
    .map((record) => ({ record, score: score(record, input) }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id),
    )
    .slice(0, CATALOG_MAX_CANDIDATES)
    .map(({ record }) => ({
      id: record.id,
      title: record.name_de,
      description: record.name_simple,
      criteria: record.criteria.map((criterion) => ({
        id: criterion.id,
        status: criterionStatus(criterion.condition, values),
        sources: [{ url: criterion.source.url, quote: criterion.source.quote, asOf: record.as_of }],
      })),
      sources: record.sources.map((source) => ({
        url: source.url,
        quote: source.quote,
        asOf: record.as_of,
      })),
    }));
}
