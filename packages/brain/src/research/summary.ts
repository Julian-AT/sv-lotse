// Research-only catalog summary and persona vocabulary for the gym's persona generator.
import { CATALOG_FACT_TYPES } from "../config/index.ts";
import { nextQuestion, startProcess } from "../engine/index.ts";
import { personaFields, regionValues } from "./gold.ts";
import { benefitProcess, processBenefit, type World } from "./world.ts";

const SEX_VALUES = ["f", "m", "d"];

/** Literal values compared against a slot in the office rules, e.g. district names or numbers. */
function ruleValues(world: World, slot: string): (string | number)[] {
  const pattern = new RegExp(
    `\\b${slot}\\s*==\\s*(?:"([^"]*)"|'([^']*)'|(-?\\d+(?:\\.\\d+)?))`,
    "g",
  );
  const values = new Set<string | number>();
  for (const record of world.benefits)
    for (const rule of record.office_rules)
      for (const match of rule.when.matchAll(pattern))
        values.add(match[3] === undefined ? (match[1] ?? match[2] ?? "") : Number(match[3]));
  return [...values].filter((value) => value !== "");
}

/** District values per federal state, read from office rules that test both. */
function districts(world: World): Record<string, (string | number)[]> {
  const result: Record<string, Set<string | number>> = {};
  const aliases = world.officeContext.aliases.region ?? [];
  for (const record of world.benefits)
    for (const rule of record.office_rules) {
      const state = aliases
        .map((alias) => new RegExp(`\\b${alias}\\s*==\\s*(?:"([^"]*)"|'([^']*)')`).exec(rule.when))
        .find(Boolean);
      const name = state?.[1] ?? state?.[2];
      if (!name || !/\bdistrict\b/.test(rule.when)) continue;
      const values = ruleValues(
        { ...world, benefits: [{ ...record, office_rules: [rule] }] },
        "district",
      );
      result[name] ??= new Set();
      for (const value of values) result[name].add(value);
    }
  return Object.fromEntries(Object.entries(result).map(([state, values]) => [state, [...values]]));
}

export function catalogSummary(world: World) {
  const carriers = new Set<string>();
  for (const record of world.benefits) for (const carrier of record.carriers) carriers.add(carrier);
  for (const value of ruleValues(world, "insurance_carrier")) carriers.add(String(value));
  const statuses = new Set<string>();
  const pensionCarriers = new Set<string>();
  for (const key of Object.keys(world.officeContext.status_values)) {
    const [status, carrier] = key.split(":");
    if (status) statuses.add(status);
    if (carrier) pensionCarriers.add(carrier);
  }
  const documents = new Map<string, { id: string; name_de: string; benefits: string[] }>();
  for (const record of world.benefits)
    for (const document of record.documents) {
      const entry = documents.get(document.id) ?? {
        id: document.id,
        name_de: document.name_de,
        benefits: [],
      };
      entry.benefits.push(record.id);
      documents.set(document.id, entry);
    }
  const lifeSituations = [
    ...new Set(world.benefits.flatMap((record) => record.life_situations)),
  ].sort();
  return {
    benefits: world.benefits.map((record) => ({
      id: record.id,
      name_de: record.name_de,
      name_simple: record.name_simple,
      area: record.area,
      scope: record.scope,
      life_situations: record.life_situations,
      process: benefitProcess(world, record)?.id ?? null,
      criteria: record.criteria.map((criterion) => ({
        id: criterion.id,
        condition: criterion.condition ?? null,
        legal_basis: criterion.legal_basis ?? null,
        source: criterion.source.url,
      })),
      documents: record.documents.map((document) => ({
        id: document.id,
        required: document.required,
      })),
      target_group: record.target_group
        ? {
            age_min: record.target_group.age_min ?? null,
            age_max: record.target_group.age_max ?? null,
            sex: record.target_group.sex ?? null,
          }
        : null,
    })),
    life_situations: lifeSituations,
    goals: world.processes.flatMap((definition) => {
      const benefit = processBenefit(world, definition);
      if (!benefit) return [];
      // Slots the engine asks before the first actionable step when nothing is known.
      const entry = nextQuestion(definition, startProcess(definition, definition.id)).missingSlots;
      return [
        {
          id: definition.id,
          benefit: benefit.id,
          name_de: benefit.name_de,
          life_situations: benefit.life_situations,
          entry_slots: entry,
          actor_roles: definition.actor_roles,
        },
      ];
    }),
    offices: { count: world.offices.size },
    vocabulary: {
      carriers: [...carriers].sort(),
      statuses: [...statuses].sort(),
      pension_carriers: [...pensionCarriers].sort(),
      states: world.states.size ? [...world.states].sort() : regionValues(world),
      regions: regionValues(world),
      districts: districts(world),
      sex: SEX_VALUES,
      needs: [] as string[],
      documents: [...documents.values()].sort((left, right) => left.id.localeCompare(right.id)),
      goals: world.processes.map((definition) => definition.id),
      life_situations: lifeSituations,
      persona_fields: personaFields,
      fact_types: CATALOG_FACT_TYPES,
      notes: {
        carriers: "insurance.carrier and insurance.pension_carrier are case-insensitive",
        needs: "no catalog condition reads the needs list; the gold mapping ignores it",
        unread:
          "employment, income_band, language, register, literacy and helper members do not change gold",
      },
    },
  };
}
