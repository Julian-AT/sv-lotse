import { describe, expect, it } from "vitest";
import {
  askable,
  asksQuestion,
  cleanLabel,
  formMode,
  handsOverData,
  modeRequest,
  questionKey,
} from "../../src/conversation/form-answers.ts";
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

describe("fill modes", () => {
  const letter =
    "Bitte füll den Reha-Antrag aus.\nEntlassungsbrief\nPatientin: Maria Beispiel, geb. 12.03.1948\n" +
    "Diagnose: Schenkelhalsfraktur rechts. Empfehlung: stationäre Rehabilitation.";

  it("defaults to step mode and switches on request", () => {
    expect(formMode(["Ich möchte Pflegegeld für meine Mutter beantragen."])).toBe("step");
    expect(formMode(["Pflegegeld beantragen", "Füll alles automatisch aus"])).toBe("fast");
    expect(formMode(["Pflegegeld beantragen", "schneller bitte"])).toBe("fast");
    expect(formMode(["alles auf einmal", "Maria", "lieber Schritt für Schritt"])).toBe("step");
    expect(formMode(["Schritt für Schritt", "mach den Rest automatisch"])).toBe("fast");
    expect(formMode(["fill it all at once please"])).toBe("fast");
    expect(formMode(["let's go step by step"])).toBe("step");
  });

  it("treats a letter pasted with the fill request as fast mode", () => {
    expect(handsOverData(letter)).toBe(true);
    expect(formMode([letter])).toBe("fast");
    expect(formMode([letter, "Schritt für Schritt bitte"])).toBe("step");
    expect(handsOverData("Wie lange dauert der Antrag?")).toBe(false);
  });

  it("does not read questions as a mode wish", () => {
    expect(modeRequest("Wie schnell geht das?")).toBeUndefined();
    expect(modeRequest("Maria Beispiel")).toBeUndefined();
  });

  it("parses mode switches and a bare yes as commands", () => {
    expect(parseFormEdit("Schritt für Schritt")).toEqual({ kind: "mode", mode: "step" });
    expect(parseFormEdit("mach den Rest automatisch")).toEqual({ kind: "mode", mode: "fast" });
    expect(parseFormEdit("schneller")).toEqual({ kind: "mode", mode: "fast" });
    expect(parseFormEdit("Ja, gerne")).toEqual({ kind: "continue" });
  });
});

describe("snippets and step walking", () => {
  it("keeps pasted values as data and questions for the agent", () => {
    expect(asksQuestion("Wie lange dauert das?")).toBe(true);
    expect(asksQuestion("Kann ich das online einreichen")).toBe(true);
    expect(asksQuestion("Maria Beispiel, geb. 12.03.1948, Hauptstraße 5, 1100 Wien")).toBe(false);
    expect(
      asksQuestion(
        "Patientin: Maria Beispiel\nGeburtsdatum: 14.03.1944\nRückfragen? Station 3B\nTelefon: 0664 1234567",
      ),
    ).toBe(false);
  });

  it("walks every applicant text field by a clean label", () => {
    expect(askable(field("f023", "Von welcher Stelle", "form.field.x.f023"))).toBe(true);
    expect(cleanLabel("Bei welcher Anstalt2")).toBe("Bei welcher Anstalt");
    expect(cleanLabel("VSNR_1")).toBe("VSNR");
    expect(askable({ ...field("f001", "Pflegegeld"), type: "checkbox" } as FormField)).toBe(false);
    expect(askable({ ...field("f067", "Familienname"), owner: "doctor" } as FormField)).toBe(false);
    // The WG's address block is not the person's address.
    expect(questionKey(field("f007", "Strassenname der Adresse WG", "form.field.x.f007"))).toBe(
      undefined,
    );
    expect(questionKey(field("f049", "Straße", "form.field.x.f049"))).toBe("address.street");
  });
});
