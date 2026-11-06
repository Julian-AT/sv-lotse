import type { Fact } from "@lotse/protocol";
import { CATALOG_FACT_TYPES } from "../../../config/index.ts";
import type { BenefitRecord, BenefitResult } from "./bundles.ts";
import { catalogCopy } from "./copy.ts";

type Status = "met" | "unknown" | "not_met";
type Guidance = {
  text: string[];
  criteria: BenefitResult["criteria"];
  sources: BenefitResult["sources"];
};
const copy = catalogCopy.de;

function uniqueValue(facts: Fact[], type: string): Fact["value"] | undefined {
  const values = facts
    .filter((fact) => fact.confirmed && fact.type === type)
    .map((fact) => fact.value);
  return values.length && values.every((value) => value === values[0]) ? values[0] : undefined;
}

function ageRange(value: unknown): [number, number] | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return [value, value];
  if (typeof value !== "string") return undefined;
  const match = /^(\d+)(?:\s*[-–]\s*(\d+)|(\+))?$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  const min = Number(match[1]);
  const max = match[3] ? Number.POSITIVE_INFINITY : Number(match[2] ?? match[1]);
  return max >= min ? [min, max] : undefined;
}

function ageStatus(
  range: [number, number] | undefined,
  min = 0,
  max = Number.POSITIVE_INFINITY,
): Status {
  if (!range) return "unknown";
  if (range[1] < min || range[0] > max) return "not_met";
  return range[0] >= min && range[1] <= max ? "met" : "unknown";
}

function familyHistoryStatus(criteria: string[], facts: Fact[]): Status {
  const documented = facts.filter(
    (fact) => fact.confirmed && fact.type === CATALOG_FACT_TYPES.familyHistory,
  );
  // Exact published criteria only: never infer a family condition from symptoms or a generic flag.
  const matches = criteria.map((criterion) =>
    documented.filter((fact) => fact.value === criterion),
  );
  return matches.some((entries) => entries.length > 0) ? "met" : "unknown";
}

export function programmeGuidance(
  record: BenefitRecord,
  ageBand: string | undefined,
  facts: Fact[],
): Guidance {
  const target = record.target_group;
  const result: Guidance = { text: [], criteria: [], sources: [] };
  if (!target) return result;
  const source = {
    url: target.rationale_source.url,
    quote: target.rationale_source.quote,
    asOf: record.as_of,
  };
  result.sources.push(source);
  result.text.push(copy.rationale(target.rationale_text));
  function criterion(id: string, text: string, status: Status): void {
    result.criteria.push({
      id: `${record.id}:${id}`,
      status,
      text,
      sources: [
        source,
        ...record.criteria.map((criterion) => ({
          url: criterion.source.url,
          quote: criterion.source.quote,
          asOf: record.as_of,
        })),
        ...record.sources.map((source) => ({
          url: source.url,
          quote: source.quote,
          asOf: record.as_of,
        })),
      ],
    });
    const explanation = { met: copy.match, unknown: copy.unknown, not_met: copy.notMet }[status];
    result.text.push(`${text} ${explanation}`);
  }
  if (target.age_min !== undefined || target.age_max !== undefined) {
    const ageFacts = facts.filter((fact) => fact.confirmed && fact.type === CATALOG_FACT_TYPES.age);
    const age = ageFacts.length ? uniqueValue(ageFacts, CATALOG_FACT_TYPES.age) : ageBand;
    criterion(
      "age",
      copy.age(target.age_min, target.age_max),
      ageStatus(ageRange(age), target.age_min, target.age_max),
    );
  }
  if (target.sex && target.sex !== "all") {
    const sex = uniqueValue(facts, CATALOG_FACT_TYPES.sex);
    const known = sex === "female" || sex === "male" || sex === "diverse";
    const status = !known ? "unknown" : sex === target.sex ? "met" : "not_met";
    criterion("sex", copy.sex(target.sex), status);
  }
  if (target.interval) result.text.push(copy.interval(target.interval));
  // A published family criterion match never establishes an earlier start or individual eligibility.
  if (target.family_history_criteria?.length) {
    criterion(
      "family-history",
      copy.familyHistory(target.family_history_criteria),
      familyHistoryStatus(target.family_history_criteria, facts),
    );
  }
  return result;
}
