import {
  lifeSituationKey,
  lifeSituationLabel,
  lifeSituationTerms,
} from "@lotse/knowledge/life-situations";
import type { Fact } from "@lotse/protocol";
import type { z } from "zod";
import { CATALOG_FACT_TYPES, CATALOG_SEARCH_MIN_TERM_LENGTH } from "../../../config/index.ts";
import { criterionStatus, findBenefits } from "../../../engine/catalog.ts";
import type { JsonValue } from "../../../engine/schema.ts";
import type { contracts } from "../../contracts/index.ts";
import type { benefitRecordSchema } from "../../contracts/records.ts";
import { catalogCopy } from "./copy.ts";
import { programmeGuidance } from "./prevention.ts";

export type BenefitRecord = z.infer<typeof benefitRecordSchema>;
export type FindInput = z.infer<(typeof contracts)["catalog.findBenefits"]["input"]>;
export type BenefitResult = z.infer<(typeof contracts)["catalog.findBenefits"]["output"]>[number];
export type Bundle = {
  lifeSituation: string;
  socialInsurance: BenefitResult[];
  outsideSocialInsurance: BenefitResult[];
};

const copy = catalogCopy.de;
function words(value: string): string[] {
  return value
    .toLocaleLowerCase("de-AT")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= CATALOG_SEARCH_MIN_TERM_LENGTH);
}

function matchesQuery(texts: string[], query: Set<string>): boolean {
  return words(texts.join(" ")).some((word) => [...query].some((term) => word.startsWith(term)));
}

/** A requested situation is a catalog key, or a label or earlier spelling of a vocabulary key. */
function requestedSituation(records: BenefitRecord[], value: string): string {
  if (records.some((record) => record.life_situations.includes(value))) return value;
  return lifeSituationKey(value) ?? value;
}

function selectedSituations(records: BenefitRecord[], input: FindInput): string[] {
  if (input.lifeSituation) return [requestedSituation(records, input.lifeSituation)];
  const query = new Set(words(input.goalText));
  const present = [...new Set(records.flatMap((record) => record.life_situations))].sort();
  // Vocabulary wording (key, label, earlier spellings) and offer names both select bundles.
  const named = present.filter((situation) => matchesQuery(lifeSituationTerms(situation), query));
  const offered = records
    .filter((record) => matchesQuery([record.name_de, record.name_simple], query))
    .flatMap((record) => record.life_situations);
  const selected = new Set([...named, ...offered]);
  // No known wording: expose the catalog for discovery instead of inventing a situation.
  return selected.size ? [...selected].sort() : present;
}

function vaccinationGuidance(
  record: BenefitRecord,
  facts: Fact[],
): { text: string[]; sources: BenefitResult["sources"] } {
  const entries = facts.filter(
    (fact) =>
      fact.confirmed &&
      fact.type === CATALOG_FACT_TYPES.vaccination &&
      fact.source.kind === "document" &&
      fact.source.documentId &&
      fact.source.page &&
      fact.source.quote?.trim(),
  );
  if (!entries.length) return { text: [copy.vaccinationMissing], sources: [] };
  return {
    text: entries
      .map((fact) => copy.vaccination(fact.source.page ?? 1, fact.source.quote ?? ""))
      .concat(copy.vaccinationBoundary),
    sources: entries.map((fact) => ({
      url: `document:${fact.source.documentId}#page=${fact.source.page}`,
      quote: fact.source.quote ?? "",
      asOf: record.as_of,
    })),
  };
}

function describeBenefit(
  record: BenefitRecord,
  lifeSituation: string,
  input: FindInput,
  facts: Fact[],
  includeVaccination: boolean,
  values: Readonly<Record<string, JsonValue>>,
): BenefitResult {
  const guidance = programmeGuidance(record, input.subject.ageBand, facts);
  const vaccination = includeVaccination
    ? vaccinationGuidance(record, facts)
    : { text: [], sources: [] };
  return {
    id: record.id,
    title: record.name_de,
    description: [
      copy.bundle(lifeSituationLabel(lifeSituation), lifeSituation, copy.scopes[record.scope]),
      record.name_simple,
      ...record.criteria.map((criterion) => criterion.text_de),
      ...guidance.text,
      ...vaccination.text,
    ].join("\n"),
    criteria: [
      ...record.criteria.map((criterion) => ({
        id: criterion.id,
        status: criterionStatus(criterion.condition, values),
        sources: [{ url: criterion.source.url, quote: criterion.source.quote, asOf: record.as_of }],
        text: criterion.text_de,
        ...(criterion.legal_basis ? { legalBasis: criterion.legal_basis } : {}),
      })),
      ...guidance.criteria,
    ],
    sources: record.sources
      .map((source) => ({ url: source.url, quote: source.quote, asOf: record.as_of }))
      .concat(guidance.sources, vaccination.sources),
    scope: record.scope,
  };
}

/** Data alone determines bundle membership, including situations added after deployment. */
export function assembleBundles(
  records: BenefitRecord[],
  input: FindInput,
  facts: Fact[] = [],
  vaccinationBenefits = new Set<string>(),
): Bundle[] {
  const values: Record<string, JsonValue> = {};
  for (const fact of facts) if (fact.confirmed) values[fact.type] = fact.value;
  for (const [key, value] of Object.entries(input.subject))
    if (value !== undefined) values[key] = value;
  const ranked = findBenefits(records, input, values);
  const ranks = new Map(ranked.map((candidate, index) => [candidate.id, index]));
  return selectedSituations(records, input).map((lifeSituation) => {
    const members = records
      .filter((record) => record.life_situations.includes(lifeSituation))
      .sort(
        (left, right) =>
          (ranks.get(left.id) ?? ranked.length) - (ranks.get(right.id) ?? ranked.length) ||
          left.id.localeCompare(right.id),
      );
    return {
      lifeSituation,
      socialInsurance: members
        .filter((record) => record.scope === "social_insurance")
        .map((record) =>
          describeBenefit(
            record,
            lifeSituation,
            input,
            facts,
            vaccinationBenefits.has(record.id),
            values,
          ),
        ),
      outsideSocialInsurance: members
        .filter((record) => record.scope !== "social_insurance")
        .map((record) =>
          describeBenefit(
            record,
            lifeSituation,
            input,
            facts,
            vaccinationBenefits.has(record.id),
            values,
          ),
        ),
    };
  });
}

/** Preserve the frozen array transport; each item's description carries its group. */
export function projectBundles(bundles: Bundle[]): BenefitResult[] {
  const results = new Map<string, BenefitResult>();
  for (const bundle of bundles) {
    for (const benefit of [...bundle.socialInsurance, ...bundle.outsideSocialInsurance]) {
      const previous = results.get(benefit.id);
      if (previous)
        previous.description += `\n${copy.additionalSituation(lifeSituationLabel(bundle.lifeSituation), bundle.lifeSituation)}`;
      else results.set(benefit.id, { ...benefit });
    }
  }
  return [...results.values()];
}
