// Research-only ground truth for the AT-Benefits gym (docs/research/lotse-rl.md §5).
// Every label comes from the product's deterministic logic: the catalog bundle assembly and
// criterion evaluator, the office rule resolver and the documents checklist status rule.
// No model is involved. See ml/README.md ("Research tool server") for the definitions.
import { randomUUID } from "node:crypto";
import type { Fact } from "@lotse/protocol";
import { z } from "zod";
import { CATALOG_FACT_TYPES } from "../config/index.ts";
import { selectOfficeReference } from "../directory/conditions.ts";
import { officeSlots } from "../directory/context.ts";
import type { BenefitRecord } from "../engine/catalog.ts";
import { nextQuestion, startProcess } from "../engine/index.ts";
import type { JsonValue, ProcessDefinition } from "../engine/schema.ts";
import { slotFactType } from "../engine/slots.ts";
import { assembleBundles, projectBundles } from "../tools/impl/catalog/bundles.ts";
import { benefitProcess, processBenefit, type World } from "./world.ts";

const text = z.string().trim().min(1);
const member = z.looseObject({
  role: z.enum(["subject", "helper"]).default("subject"),
  age: z.number().int().min(0).max(130).nullish(),
  sex: z.string().nullish(),
  residence: z
    .looseObject({ state: text.nullish(), district: z.union([text, z.number()]).nullish() })
    .nullish(),
  insurance: z
    .looseObject({
      carrier: text.nullish(),
      status: text.nullish(),
      pension_carrier: text.nullish(),
    })
    .nullish(),
  employment: z.string().nullish(),
  income_band: z.string().nullish(),
  children: z.array(z.unknown()).nullish(),
  documents_held: z.array(z.string()).nullish(),
  language: z.string().nullish(),
  register: z.string().nullish(),
  literacy: z.string().nullish(),
});
export const personaSchema = z.looseObject({
  id: z.string().optional(),
  household: z.array(member).min(1),
  situation_text: z.string().default(""),
  goal: text,
  /** Optional: one of the goal benefit's life situations; defaults to its first one. */
  life_situation: text.optional(),
  /** Optional: persona field paths (see `personaFields`) the opening statement already states. */
  opening_facts: z.array(text).optional(),
});
export type Persona = z.infer<typeof personaSchema>;
type Member = z.infer<typeof member>;

export class GoldError extends Error {
  constructor(
    readonly code: "UNKNOWN_GOAL" | "UNKNOWN_LIFE_SITUATION" | "UNKNOWN_OPENING_FACT",
    message: string,
  ) {
    super(message);
    this.name = "GoldError";
  }
}

const SEX_VALUES: Record<string, string> = {
  f: "female",
  female: "female",
  w: "female",
  m: "male",
  male: "male",
  d: "diverse",
  x: "diverse",
  diverse: "diverse",
};

/** Persona field path → engine fact keys it sets. The vocabulary endpoint publishes this table. */
export const personaFields = {
  "residence.state": [
    "residence.state",
    "residence.region",
    "residence_region",
    "residence_state",
    "federal_state",
    "region",
    "domestic_residence",
    "residence_austria",
    "centre_austria",
  ],
  "residence.district": ["district"],
  "insurance.carrier": ["insurance.carrier", "insurance_carrier", "carrier"],
  "insurance.status": ["insurance.status", "status"],
  "insurance.pension_carrier": ["insurance.pension_source", "pension_source"],
  age: [CATALOG_FACT_TYPES.age, "ageBand"],
  sex: [CATALOG_FACT_TYPES.sex],
  "care.pflegegeld_level": ["care_level"],
  children: ["child_born"],
} as const satisfies Record<string, readonly string[]>;
export type PersonaField = keyof typeof personaFields;

function fieldValue(item: Member, path: PersonaField): unknown {
  let current: unknown = item;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function subjectMember(persona: Persona): Member {
  const subject = persona.household.find((item) => item.role === "subject") ?? persona.household[0];
  if (!subject) throw new Error("Persona household is empty");
  return subject;
}

export function regionValues(world: World): string[] {
  const aliases = new Set(world.officeContext.aliases.region ?? []);
  const values = new Set<string>();
  for (const definition of world.processes)
    for (const slot of definition.slots)
      if (aliases.has(slot.id))
        for (const option of slot.validation?.options ?? []) values.add(option);
  return [...values];
}

function carrierValue(world: World, value: string): string {
  const lower = value.toLocaleLowerCase("de-AT");
  return world.officeContext.carrier_aliases[lower] ?? lower;
}

/** Status passed to office resolution: "pensioner:<pension carrier>" when the pension carrier is known. */
function officeStatus(world: World, subject: Member): string {
  const status = subject.insurance?.status?.toLowerCase();
  const pension = subject.insurance?.pension_carrier;
  if (pension && (!status || status === "pensioner"))
    return `pensioner:${carrierValue(world, pension)}`;
  return status ?? "";
}

function districtValue(value: string | number): string | number {
  if (typeof value === "number") return value;
  // Numbered districts (for example Vienna's) are compared as numbers by the office rules.
  const numbered = /^(\d{1,2})(?:\.|\s|$)/.exec(value.trim());
  return numbered?.[1] ? Number(numbered[1]) : value.trim();
}

/** Facts keyed by field path. Only fields present on the persona produce facts. */
export function personaFacts(
  world: World,
  persona: Persona,
): Map<PersonaField, Record<string, JsonValue>> {
  const subject = subjectMember(persona);
  const result = new Map<PersonaField, Record<string, JsonValue>>();
  const state = subject.residence?.state;
  if (state) {
    const domestic = world.states.has(state);
    result.set("residence.state", {
      "residence.state": state,
      "residence.region": state,
      residence_region: state,
      residence_state: state,
      federal_state: state,
      region: state,
      domestic_residence: domestic,
      residence_austria: domestic,
      centre_austria: domestic,
    });
  }
  const district = subject.residence?.district;
  if (district !== undefined && district !== null)
    result.set("residence.district", { district: districtValue(district) });
  const carrier = subject.insurance?.carrier;
  if (carrier) {
    const value = carrierValue(world, carrier);
    result.set("insurance.carrier", {
      "insurance.carrier": value,
      insurance_carrier: value,
      carrier: value,
    });
  }
  const status = officeStatus(world, subject);
  if (subject.insurance?.status)
    result.set("insurance.status", {
      "insurance.status": subject.insurance.status.toLowerCase(),
      status: subject.insurance.status.toLowerCase(),
    });
  const pensionSource = world.officeContext.status_values[status]?.pension_source;
  if (pensionSource)
    result.set("insurance.pension_carrier", {
      "insurance.pension_source": pensionSource,
      pension_source: pensionSource,
    });
  if (typeof subject.age === "number")
    result.set("age", { [CATALOG_FACT_TYPES.age]: subject.age, ageBand: String(subject.age) });
  const sex = subject.sex ? SEX_VALUES[subject.sex.toLowerCase()] : undefined;
  if (sex) result.set("sex", { [CATALOG_FACT_TYPES.sex]: sex });
  const level = fieldValue(subject, "care.pflegegeld_level");
  // Read by path: the member schema is loose, so the nested object needs no named key here.
  if (typeof level === "number" && Number.isInteger(level) && level > 0)
    result.set("care.pflegegeld_level", { care_level: level });
  if (subject.children?.length) result.set("children", { child_born: true });
  return result;
}

function flatten(groups: Iterable<Record<string, JsonValue>>): Record<string, JsonValue> {
  return Object.assign({}, ...groups) as Record<string, JsonValue>;
}

function asFacts(subjectId: string, values: Record<string, JsonValue>): Fact[] {
  return Object.entries(values).map(([type, value]) => ({
    id: randomUUID(),
    subjectId,
    type,
    value,
    source: { kind: "statement" },
    confidence: 1,
    confirmed: true,
  }));
}

function personaWarnings(world: World, subject: Member): string[] {
  const warnings: string[] = [];
  const known = new Set(regionValues(world));
  const state = subject.residence?.state;
  if (state && !known.has(state)) warnings.push(`residence.state ${state} is not a known region`);
  const district = subject.residence?.district;
  if (district !== undefined && district !== null) {
    const pattern = /\bdistrict\s*==\s*(?:"([^"]*)"|'([^']*)'|(\d+))/g;
    const districts = new Set<string | number>();
    for (const record of world.benefits)
      for (const rule of record.office_rules)
        for (const match of rule.when.matchAll(pattern))
          districts.add(match[3] === undefined ? (match[1] ?? match[2] ?? "") : Number(match[3]));
    if (!districts.has(districtValue(district)))
      warnings.push(
        `residence.district ${district} matches no office rule; see vocabulary.districts`,
      );
  }
  const carriers = new Set(
    world.benefits
      .flatMap((record) => record.carriers as string[])
      .concat(Object.values(world.officeContext.carrier_aliases)),
  );
  const carrier = subject.insurance?.carrier;
  if (carrier && !carriers.has(carrierValue(world, carrier)))
    warnings.push(`insurance.carrier ${carrier} is not a known carrier`);
  const pension = subject.insurance?.pension_carrier;
  if (pension && !world.officeContext.status_values[`pensioner:${carrierValue(world, pension)}`])
    warnings.push(`insurance.pension_carrier ${pension} has no pension source mapping`);
  const status = subject.insurance?.status?.toLowerCase();
  const statuses = new Set(
    Object.keys(world.officeContext.status_values).map((key) => key.split(":")[0]),
  );
  if (status && !statuses.has(status))
    warnings.push(`insurance.status ${status} is not a known status`);
  if (subject.sex && !SEX_VALUES[subject.sex.toLowerCase()])
    warnings.push(`sex ${subject.sex} is not f, m or d`);
  const documents = new Set(
    world.benefits.flatMap((record) => record.documents.map((document) => document.id)),
  );
  for (const held of subject.documents_held ?? [])
    if (!documents.has(held)) warnings.push(`documents_held ${held} is not a catalog document id`);
  return warnings;
}

export function resolveGoal(world: World, goal: string): ProcessDefinition {
  const byProcess = world.processes.find((definition) => definition.id === goal);
  if (byProcess) return byProcess;
  const record = world.benefits.find((item) => item.id === goal);
  const definition = record ? benefitProcess(world, record) : undefined;
  if (!definition)
    throw new GoldError(
      "UNKNOWN_GOAL",
      "goal must be a process id or benefit id from GET /catalog/summary",
    );
  return definition;
}

function normalizedText(value: string): string {
  return ` ${value
    .toLocaleLowerCase("de-AT")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replaceAll("ß", "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")} `;
}

/** Values the opening statement provides: declared field paths plus enum values named verbatim. */
export function openingValues(
  definition: ProcessDefinition,
  persona: Persona,
  facts: Map<PersonaField, Record<string, JsonValue>>,
): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  for (const path of persona.opening_facts ?? []) {
    if (!(path in personaFields))
      throw new GoldError(
        "UNKNOWN_OPENING_FACT",
        `opening_facts entry ${path} is not a persona field`,
      );
    Object.assign(values, facts.get(path as PersonaField) ?? {});
  }
  const all = flatten(facts.values());
  const spoken = normalizedText(persona.situation_text);
  for (const slot of definition.slots) {
    const value = all[slotFactType(slot)];
    if (typeof value !== "string" || !slot.validation?.options?.includes(value)) continue;
    if (spoken.includes(normalizedText(value))) values[slotFactType(slot)] = value;
  }
  return values;
}

export type Gold = {
  /** Persona values outside the vocabulary of GET /catalog/summary; they cannot match any rule. */
  warnings: string[];
  goal: string;
  process: string;
  life_situation: string;
  benefits: string[];
  offices: Record<string, string>;
  offices_unresolved: string[];
  documents: Record<string, string[]>;
  documents_status: Record<string, Record<string, "have" | "missing" | "obtainable">>;
  criteria_status: Record<string, Record<string, "met" | "unknown" | "not_met">>;
  excluded: { benefitId: string; criteria: string[] }[];
  min_questions: number;
  question_slots: string[];
  citations: {
    benefitId: string;
    criterionId: string;
    status: "met" | "unknown";
    source: string;
    quote: string;
    legalBasis?: string;
  }[];
  facts: Record<string, JsonValue>;
};

export async function computeGold(world: World, raw: unknown): Promise<Gold> {
  const persona = personaSchema.parse(raw);
  const definition = resolveGoal(world, persona.goal);
  const goalBenefit = processBenefit(world, definition);
  if (!goalBenefit) throw new GoldError("UNKNOWN_GOAL", "goal process has no catalog benefit");
  const situations = goalBenefit.life_situations;
  const lifeSituation = persona.life_situation ?? situations[0];
  if (!lifeSituation || !situations.includes(lifeSituation))
    throw new GoldError(
      "UNKNOWN_LIFE_SITUATION",
      `life_situation must be one of the goal benefit's life situations: ${situations.join(", ")}`,
    );
  const subject = subjectMember(persona);
  const grouped = personaFacts(world, persona);
  const values = flatten(grouped.values());
  const subjectId = randomUUID();
  const facts = asFacts(subjectId, values);
  const input = {
    lifeSituation,
    goalText: persona.situation_text,
    subject: {
      ...(typeof subject.age === "number" ? { ageBand: String(subject.age) } : {}),
      ...(typeof values.carrier === "string" ? { carrier: values.carrier } : {}),
      ...(typeof values.region === "string" ? { region: values.region } : {}),
      ...(typeof values.status === "string" ? { status: values.status } : {}),
    },
  };
  // The product's bundle: every benefit of the life situation, with each criterion evaluated.
  const bundle = projectBundles(assembleBundles(world.benefits, input, facts));
  const records = new Map(world.benefits.map((record) => [record.id, record]));
  const kept: { record: BenefitRecord; item: (typeof bundle)[number] }[] = [];
  const excluded: Gold["excluded"] = [];
  const criteriaStatus: Gold["criteria_status"] = {};
  for (const item of bundle) {
    const record = records.get(item.id);
    if (!record) continue;
    const statuses = Object.fromEntries(
      item.criteria.map((criterion) => [criterion.id, criterion.status]),
    );
    criteriaStatus[item.id] = statuses;
    // Unknown never excludes: missing data is not a negative eligibility claim (engine rule).
    const failed = item.criteria.filter((criterion) => criterion.status === "not_met");
    if (failed.length)
      excluded.push({ benefitId: item.id, criteria: failed.map((criterion) => criterion.id) });
    else kept.push({ record, item });
  }
  kept.sort((left, right) => left.record.id.localeCompare(right.record.id));
  const offices: Gold["offices"] = {};
  const unresolved: string[] = [];
  const slots = await officeSlots(
    {
      carrier: typeof values.carrier === "string" ? values.carrier : "",
      region: typeof values.region === "string" ? values.region : "",
      subjectStatus: officeStatus(world, subject),
    },
    facts,
  );
  for (const { record } of kept) {
    try {
      const reference = selectOfficeReference(record.office_rules, slots);
      const office = reference.startsWith("ref:offices/")
        ? world.offices.get(reference.slice("ref:offices/".length))
        : undefined;
      if (office) offices[record.id] = office;
      else unresolved.push(record.id);
    } catch {
      unresolved.push(record.id);
    }
  }
  const held = new Set(subject.documents_held ?? []);
  const documents: Gold["documents"] = {};
  const documentsStatus: Gold["documents_status"] = {};
  for (const { record } of kept) {
    // Same status rule as documents.checklist; gold lists the required documents.
    documentsStatus[record.id] = Object.fromEntries(
      record.documents.map((document) => [
        document.id,
        held.has(document.id) ? "have" : document.required ? "missing" : "obtainable",
      ]),
    );
    documents[record.id] = record.documents
      .filter((document) => document.required)
      .map((document) => document.id);
  }
  const citations: Gold["citations"] = [];
  // The product's criteria for the bundle item: catalog criteria plus target-group checks.
  for (const { record, item } of kept)
    for (const criterion of item.criteria) {
      const source = criterion.sources[0];
      if (!source || (criterion.status !== "met" && criterion.status !== "unknown")) continue;
      const legalBasis = record.criteria.find((entry) => entry.id === criterion.id)?.legal_basis;
      citations.push({
        benefitId: record.id,
        criterionId: criterion.id,
        status: criterion.status,
        source: source.url,
        quote: source.quote,
        ...(legalBasis ? { legalBasis } : {}),
      });
    }
  const opening = openingValues(definition, persona, grouped);
  const started = startProcess(definition, persona.goal, opening);
  const questions = nextQuestion(definition, started).missingSlots;
  return {
    warnings: personaWarnings(world, subject),
    goal: persona.goal,
    process: definition.id,
    life_situation: lifeSituation,
    benefits: kept.map(({ record }) => record.id),
    offices,
    offices_unresolved: unresolved,
    documents,
    documents_status: documentsStatus,
    criteria_status: criteriaStatus,
    excluded,
    min_questions: questions.length,
    question_slots: questions,
    citations,
    facts: values,
  };
}
