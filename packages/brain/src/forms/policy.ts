import type { facts } from "@lotse/db/schema";
import policyData from "@lotse/knowledge/form-policy" with { type: "json" };
import { type JsonValue, type Provenance, ProvenanceSchema } from "@lotse/protocol";
import { z } from "zod";
import { canonicalJson } from "../approvals/canonical.ts";
import { type FormField, ValidationSchema } from "./schema.ts";

export const formPolicy = z
  .object({ iban_pattern: z.string().min(1), discovery_pattern: z.string().min(1) })
  .parse(policyData);
const ibanPattern = new RegExp(formPolicy.iban_pattern, "iu");
export type ConfirmedFact = typeof facts.$inferSelect;
export type FieldProposal = { fieldId: string; value: JsonValue; provenance: Provenance };

export function writableField(field: FormField): boolean {
  return field.owner === "applicant" && field.signature === "none" && field.type !== "signature";
}

export function ibanField(field: FormField): boolean {
  return ibanPattern.test([field.fact_type, field.label_de, field.acro_field].join(" "));
}

export function validFieldValue(field: FormField, value: JsonValue): boolean {
  const parsed = ValidationSchema.safeParse(field.validation);
  if (!parsed.success || value === null || typeof value === "object") return false;
  const rules = parsed.data;
  const text = String(value);
  return validType(field, value) && validBounds(rules, value) && validText(rules, text);
}

function validType(field: FormField, value: JsonValue): boolean {
  if (field.type === "checkbox") return typeof value === "boolean";
  if (typeof value === "boolean") return false;
  if (field.type === "date") return z.iso.date().safeParse(value).success;
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value);
  return true;
}

function validBounds(rules: z.infer<typeof ValidationSchema>, value: JsonValue): boolean {
  if (rules.min !== undefined && (typeof value !== "number" || value < rules.min)) return false;
  if (rules.max !== undefined && (typeof value !== "number" || value > rules.max)) return false;
  return true;
}

function validText(rules: z.infer<typeof ValidationSchema>, text: string): boolean {
  if (!text.trim()) return false;
  if (rules.min_length !== undefined && text.length < rules.min_length) return false;
  if (rules.max_length !== undefined && text.length > rules.max_length) return false;
  if (rules.options && !rules.options.includes(text)) return false;
  if (rules.pattern) {
    try {
      if (!new RegExp(rules.pattern, "u").test(text)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function factProvenance(fact: ConfirmedFact, field: FormField): Provenance | undefined {
  const sourceWithReference = {
    ...fact.source,
    ...(fact.source.kind === "document" && fact.source.documentId === undefined && fact.documentId
      ? { documentId: fact.documentId }
      : {}),
    ...(fact.source.kind === "statement" && fact.source.turnId === undefined && fact.turnId
      ? { turnId: fact.turnId }
      : {}),
  };
  const parsed = ProvenanceSchema.safeParse({ factId: fact.id, source: sourceWithReference });
  if (!fact.confirmed || !parsed.success || !parsed.data.source.quote?.trim()) return;
  const source = parsed.data.source;
  if (source.kind === "document" && (!fact.documentId || source.documentId !== fact.documentId))
    return;
  if (source.kind === "statement" && (!fact.turnId || source.turnId !== fact.turnId)) return;
  if (ibanField(field) && (source.kind !== "statement" || fact.documentId !== null)) return;
  return parsed.data;
}

/** Ambiguous or invalid facts remain missing; no name, medical or label-based inference. */
export function proposeFields(
  fields: FormField[],
  confirmedFacts: ConfirmedFact[],
): { proposals: FieldProposal[]; missingFields: string[] } {
  const proposals: FieldProposal[] = [];
  const missingFields: string[] = [];
  for (const field of fields) {
    if (!writableField(field)) continue;
    const candidates = confirmedFacts.filter(
      (fact) =>
        field.fact_type &&
        fact.type === field.fact_type &&
        validFieldValue(field, fact.value) &&
        factProvenance(fact, field),
    );
    const distinct = new Set(candidates.map((fact) => canonicalJson(fact.value)));
    const fact = candidates[0];
    const provenance = fact && factProvenance(fact, field);
    if (distinct.size === 1 && fact && provenance)
      proposals.push({ fieldId: field.id, value: fact.value, provenance });
    else missingFields.push(field.id);
  }
  return { proposals, missingFields };
}
