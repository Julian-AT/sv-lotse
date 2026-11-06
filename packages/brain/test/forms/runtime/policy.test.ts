import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type ConfirmedFact, proposeFields, validFieldValue } from "../../../src/forms/policy.ts";
import type { FormField } from "../../../src/forms/schema.ts";

// Test-only schema/facts exercise safety cases absent from the blank official PDFs.
export function field(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "test-field",
    label_de: "Name",
    type: "text",
    page: 1,
    owner: "applicant",
    signature: "none",
    method: "acroform",
    confidence: 1,
    validation: {},
    fact_type: "person.name",
    ...overrides,
  };
}
function fact(overrides: Partial<ConfirmedFact> = {}): ConfirmedFact {
  const turnId = randomUUID();
  return {
    id: randomUUID(),
    subjectId: randomUUID(),
    type: "person.name",
    value: "Ada Beispiel",
    documentId: null,
    turnId,
    sourceFactId: null,
    source: { kind: "statement", turnId, quote: "Mein Name ist Ada Beispiel." },
    confidence: 1,
    confirmed: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("FR-D5 proposals", () => {
  it("proposes only confirmed, unambiguous facts and carries their exact quote", () => {
    const confirmed = fact();
    const result = proposeFields(
      [field()],
      [confirmed, fact({ confirmed: false, value: "Other" })],
    );
    expect(result.proposals).toEqual([
      {
        fieldId: "test-field",
        value: confirmed.value,
        provenance: { factId: confirmed.id, source: confirmed.source },
      },
    ]);
    expect(proposeFields([field()], [confirmed, fact({ value: "Other" })]).missingFields).toEqual([
      "test-field",
    ]);
    expect(
      proposeFields([field()], [fact({ source: { kind: "statement", quote: "" } })]).proposals,
    ).toEqual([]);
  });
  it("never proposes doctor, hospital, office or signature fields", () => {
    for (const owner of ["doctor", "hospital", "office"] as const)
      expect(proposeFields([field({ owner })], [fact()]).proposals).toEqual([]);
    expect(proposeFields([field({ signature: "subject" })], [fact()]).proposals).toEqual([]);
    expect(proposeFields([field({ type: "signature" })], [fact()]).proposals).toEqual([]);
  });
  it("uses authoritative source foreign keys when their optional JSON copy is absent", () => {
    const statement = fact({ source: { kind: "statement", quote: "Ada Beispiel" } });
    expect(proposeFields([field()], [statement]).proposals[0]?.provenance.source.turnId).toBe(
      statement.turnId,
    );
    const documentId = randomUUID();
    const document = fact({
      documentId,
      turnId: null,
      source: { kind: "document", quote: "Name: Ada Beispiel" },
    });
    expect(proposeFields([field()], [document]).proposals[0]?.provenance.source.documentId).toBe(
      documentId,
    );
    expect(
      proposeFields(
        [field()],
        [fact({ source: { kind: "statement", turnId: randomUUID(), quote: "Ada Beispiel" } })],
      ).proposals,
    ).toEqual([]);
  });
  it("uses an IBAN only from a directly confirmed user statement", () => {
    const bankField = field({ label_de: "IBAN", fact_type: "bank.iban" });
    const bankFact = fact({ type: "bank.iban", value: "AT611904300234573201" });
    const documentId = randomUUID();
    const extracted = fact({
      ...bankFact,
      documentId,
      turnId: null,
      source: { kind: "document", documentId, quote: "IBAN AT611904300234573201" },
    });
    expect(proposeFields([bankField], [extracted]).missingFields).toEqual([bankField.id]);
    expect(proposeFields([bankField], [bankFact]).proposals[0]?.value).toBe(bankFact.value);
  });
  it("checks type, bounds, options and format before proposing a value", () => {
    expect(validFieldValue(field({ type: "checkbox" }), false)).toBe(true);
    expect(validFieldValue(field({ type: "checkbox" }), "false")).toBe(false);
    expect(validFieldValue(field({ type: "date" }), "2026-02-30")).toBe(false);
    expect(validFieldValue(field({ type: "number", validation: { min: 0, max: 9 } }), 10)).toBe(
      false,
    );
    expect(validFieldValue(field({ validation: { options: ["A", "B"] } }), "C")).toBe(false);
    expect(validFieldValue(field({ validation: { pattern: "^[0-9]+$" } }), "abc")).toBe(false);
  });
});
