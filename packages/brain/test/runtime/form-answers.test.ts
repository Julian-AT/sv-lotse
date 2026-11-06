import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applicantOf,
  fieldQuestion,
  fieldValue,
  pendingFormQuestion,
  questionKey,
} from "../../src/conversation/form-answers.ts";
import type { FormField } from "../../src/forms/schema.ts";
import { createSegmentWriter } from "../../src/pipeline/segment.ts";
import type { LotseMessage } from "../../src/tools/types.ts";
import { config } from "./helpers.ts";

function field(factType: string, type: FormField["type"] = "text", maxLength = 40): FormField {
  return {
    id: "f001",
    label_de: "Feld",
    labels: {},
    type,
    validation: { max_length: maxLength },
    fact_type: factType,
    owner: "applicant",
    signature: "none",
  } as unknown as FormField;
}

describe("fieldValue", () => {
  it("reads names without lead-ins and rejects sentences", () => {
    expect(fieldValue(field("person.family_name"), "Sie heißt Müller.", false)?.value).toBe(
      "Müller",
    );
    expect(fieldValue(field("person.given_name"), "Maria Anna", false)?.value).toBe("Maria Anna");
    expect(fieldValue(field("person.family_name"), "Sie hat Demenz", false)).toBeUndefined();
    expect(fieldValue(field("person.family_name"), "1234", false)).toBeUndefined();
  });

  it("normalizes birth dates and reads them back", () => {
    expect(fieldValue(field("person.birth_date"), "12. März 1948", false)).toEqual({
      value: "12.03.1948",
      readBack: "12.03.1948",
    });
    expect(fieldValue(field("person.birth_date"), "3.7.1950", false)?.value).toBe("03.07.1950");
    expect(fieldValue(field("person.birth_date", "date"), "12.03.1948", false)?.value).toBe(
      "1948-03-12",
    );
    expect(fieldValue(field("person.birth_date"), "31. Februar 1948", false)).toBeUndefined();
    expect(fieldValue(field("person.birth_date"), "irgendwann", false)).toBeUndefined();
  });

  it("checks numbers and email addresses", () => {
    expect(fieldValue(field("person.insurance_number"), "1234 120348", false)?.value).toBe(
      "1234120348",
    );
    expect(fieldValue(field("person.insurance_number"), "12345", false)).toBeUndefined();
    expect(fieldValue(field("address.postcode"), "1100", false)?.value).toBe("1100");
    expect(fieldValue(field("contact.email"), "maria@example.at", false)?.value).toBe(
      "maria@example.at",
    );
    expect(fieldValue(field("contact.email"), "keine", false)).toBeUndefined();
  });
});

describe("questions", () => {
  it("asks short questions about the person the form is for", () => {
    const applicant = applicantOf(["Ja, öffnen", "Pflegegeld für meine Mutter"], false);
    expect(fieldQuestion(field("person.birth_date"), applicant, false)).toBe(
      "Wie lautet das Geburtsdatum Ihrer Mutter?",
    );
    expect(applicantOf(["Wo beantrage ich Pflegegeld?"], false)).toBe(
      "der antragstellenden Person",
    );
  });

  it("finds the pending question in the last assistant message only", () => {
    const formQuestion = { formInstanceId: randomUUID(), fieldId: "f005" };
    const asked: LotseMessage = {
      id: randomUUID(),
      role: "assistant",
      metadata: { formQuestion },
      parts: [{ type: "text", text: "Wie lautet das Geburtsdatum Ihrer Mutter?" }],
    };
    const later: LotseMessage = { id: randomUUID(), role: "assistant", parts: [] };
    expect(pendingFormQuestion([asked])).toEqual(formQuestion);
    expect(pendingFormQuestion([asked, later])).toBeUndefined();
  });
});

describe("questionKey", () => {
  it("asks detected applicant fields by label, never provider sections", () => {
    const detected = (label: string, owner = "applicant") =>
      ({ ...field("form.field.t.f9"), label_de: label, owner }) as FormField;
    expect(questionKey(detected("Familienname"))).toBe("person.family_name");
    expect(questionKey(detected("PLZ"))).toBe("address.postcode");
    expect(questionKey(detected("Telefon", "doctor"))).toBeUndefined();
    expect(questionKey(detected("Diagnose"))).toBeUndefined();
    expect(questionKey(field("person.title"))).toBeUndefined();
  });
});

it("reads the answered value back in the streamed text and the spoken segment", () => {
  const chunks: { type: string; delta?: string; data?: { text: string } }[] = [];
  const output = createSegmentWriter({
    writer: { write: (chunk) => void chunks.push(chunk as never) },
    context: {
      caseId: randomUUID(),
      subjectId: randomUUID(),
      actorId: randomUUID(),
      userId: randomUUID(),
      sessionId: randomUUID(),
      actorRole: "subject",
      autonomyLevel: "L3",
      shareScope: {},
      sentenceIndex: 0,
    },
    turnId: randomUUID(),
    language: "de-AT",
    config,
    passages: new Map(),
  });
  const readBack = fieldValue(field("person.birth_date"), "12. März 1948", false)?.readBack;
  output.emit(
    randomUUID(),
    `Danke, eingetragen: ${readBack}. Wie lautet der Vorname Ihrer Mutter?`,
  );
  expect(chunks.find((chunk) => chunk.type === "text-delta")?.delta).toContain("12.03.1948");
  expect(chunks.find((chunk) => chunk.type === "data-speech-segment")?.data?.text).toBe(
    "Danke, eingetragen: 12.03.1948.",
  );
});
