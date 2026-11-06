import { describe, expect, it } from "vitest";
import { parseFormEdit, resolveFields } from "../../src/conversation/form-edit.ts";
import type { FormField } from "../../src/forms/schema.ts";

function field(id: string, label: string, factType?: string): FormField {
  return {
    id,
    label_de: label,
    labels: {},
    type: "text",
    validation: { max_length: 80 },
    ...(factType ? { fact_type: factType } : {}),
    owner: "applicant",
    signature: "none",
  } as unknown as FormField;
}

const pflegegeld = [
  field("f001", "Fam.Name", "person.family_name"),
  field("f002", "Vorname", "person.given_name"),
  field("f005", "Geburtsdatum", "person.birth_date"),
  field("f011", "Adresse Straße", "address.street"),
  field("f012", "Hausnummer, Stiege, Tür", "address.building_unit"),
  field("f013", "PLZ", "address.postcode"),
  field("f014", "Ort", "address.city"),
  field("f017", "Telefon", "contact.phone"),
  field("f018", "Email", "contact.email"),
  field("f029", "Telefon 1", "representative.phone"),
  field("f031", "VSNR_1", "person.insurance_number"),
];
const reha = [
  field("f006", "Patient(in)", "person.name"),
  field("f008", "Telefonnummer", "contact.phone"),
  field("f009", "Anschrift Patient(in)", "address.full"),
  field("f041", "Geburtsjahr", "form.field.x.f041"),
];

describe("parseFormEdit", () => {
  it("reads change commands in German and English", () => {
    expect(parseFormEdit("Ändere das Geburtsdatum auf 12. März 1948.")).toEqual({
      kind: "set",
      field: "das Geburtsdatum",
      value: "12. März 1948",
      force: false,
    });
    expect(parseFormEdit("Telefonnummer ist 0664 123 45 67")).toMatchObject({
      kind: "set",
      field: "Telefonnummer",
      value: "0664 123 45 67",
    });
    expect(parseFormEdit("Bitte trag bei Telefon 01 234 567 ein")).toMatchObject({
      kind: "set",
      field: "Telefon",
      value: "01 234 567",
    });
    expect(parseFormEdit("Trag maria@example.at als E-Mail ein")).toMatchObject({
      kind: "set",
      field: "E-Mail",
      value: "maria@example.at",
    });
    expect(parseFormEdit("change the phone number to 0664 1234567")).toMatchObject({
      kind: "set",
      field: "the phone number",
      value: "0664 1234567",
    });
    expect(parseFormEdit("Die PLZ ist trotzdem 1100")).toMatchObject({
      kind: "set",
      value: "1100",
      force: true,
    });
  });

  it("reads clearing, navigation, missing and read-aloud commands", () => {
    expect(parseFormEdit("lösch die Adresse")).toEqual({
      kind: "clear",
      field: "die Adresse",
      force: false,
    });
    expect(parseFormEdit("Die Telefonnummer bitte löschen.")).toMatchObject({
      kind: "clear",
      field: "Die Telefonnummer",
    });
    expect(parseFormEdit("clear the email")).toMatchObject({ kind: "clear", field: "the email" });
    expect(parseFormEdit("nächstes Feld")).toEqual({ kind: "next" });
    expect(parseFormEdit("Weiter.")).toEqual({ kind: "next" });
    expect(parseFormEdit("next field")).toEqual({ kind: "next" });
    expect(parseFormEdit("Was fehlt noch?")).toEqual({ kind: "missing" });
    expect(parseFormEdit("what's still missing?")).toEqual({ kind: "missing" });
    expect(parseFormEdit("Lies mir das Formular vor")).toEqual({ kind: "read" });
    expect(parseFormEdit("Was steht jetzt im Formular?")).toEqual({ kind: "read" });
    expect(parseFormEdit("read the form back to me")).toEqual({ kind: "read" });
  });

  it("leaves questions, letters and plain answers to the other handlers", () => {
    expect(parseFormEdit("Was ist das Pflegegeld?")).toBeUndefined();
    expect(parseFormEdit("Ist die Telefonnummer wichtig?")).toBeUndefined();
    expect(parseFormEdit("Maria Müller")).toBeUndefined();
    expect(parseFormEdit("Sehr geehrte Damen und Herren,\nPatientin: Maria")).toBeUndefined();
  });
});

describe("resolveFields", () => {
  it("finds fields by spoken name, label variant and language", () => {
    const ids = (spoken: string, fields = pflegegeld) =>
      resolveFields(fields, spoken).map((item) => item.id);
    expect(ids("das Geburtsdatum")).toEqual(["f005"]);
    expect(ids("date of birth")).toEqual(["f005"]);
    expect(ids("Telefonnummer")).toEqual(["f017"]);
    expect(ids("the phone number")).toEqual(["f017"]);
    expect(ids("Handynummer")).toEqual(["f017"]);
    expect(ids("die E-Mail-Adresse")).toEqual(["f018"]);
    expect(ids("Postleitzahl")).toEqual(["f013"]);
    expect(ids("Nachname")).toEqual(["f001"]);
    expect(ids("SV-Nummer")).toEqual(["f031"]);
    expect(ids("die Adresse")).toEqual(["f011", "f012", "f013", "f014"]);
    expect(ids("Name")).toEqual(["f001", "f002"]);
    expect(ids("die Adresse", reha)).toEqual(["f009"]);
    expect(ids("Name", reha)).toEqual(["f006"]);
    expect(ids("Telefonnummer", reha)).toEqual(["f008"]);
    expect(ids("Geburtsjahr", reha)).toEqual(["f041"]);
    expect(ids("Lieblingsfarbe")).toEqual([]);
  });
});
