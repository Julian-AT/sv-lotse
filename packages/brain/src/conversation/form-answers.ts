import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { documents, facts, formFields, formInstances } from "@lotse/db/schema";
import {
  type Action,
  ActionSchema,
  type JsonValue,
  type Provenance,
  ProvenanceSchema,
} from "@lotse/protocol";
import { generateText, type LanguageModel, Output } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import { FORM_TYPE_PACE_MS } from "../config/index.ts";
import { identityField, validFieldValue, writableField } from "../forms/policy.ts";
import { getTemplate } from "../forms/registry/index.ts";
import { type FormField, templateSchema } from "../forms/schema.ts";
import type { LotseMessage } from "../tools/types.ts";

// Only administrative identity, address and contact fields are asked for; medical sections stay
// empty and are never inferred.
const QUESTIONS: Readonly<Record<string, { de: string; en: string }>> = {
  "person.family_name": { de: "der Familienname", en: "the family name" },
  "person.given_name": { de: "der Vorname", en: "the first name" },
  "person.birth_date": { de: "das Geburtsdatum", en: "the date of birth" },
  "person.insurance_number": {
    de: "die Sozialversicherungsnummer",
    en: "the social security number",
  },
  "address.street": { de: "die Straße der Wohnadresse", en: "the street" },
  "address.building_unit": { de: "Hausnummer, Stiege und Tür", en: "the house and door number" },
  "address.postcode": { de: "die Postleitzahl", en: "the postcode" },
  "address.city": { de: "der Wohnort", en: "the town" },
  "contact.phone": { de: "die Telefonnummer", en: "the phone number" },
  "contact.email": { de: "die E-Mail-Adresse", en: "the email address" },
};

// Detected forms (acquired PDFs) carry no administrative fact types; their applicant fields are
// recognized by label for asking only, never for prefilling.
const LABEL_KEYS: readonly [RegExp, string][] = [
  [/familienname|nachname|zuname/iu, "person.family_name"],
  [/vorname/iu, "person.given_name"],
  [/geburtsdatum|geb\.\s*datum/iu, "person.birth_date"],
  [/versicherungsnummer|vsnr|sv-?nummer/iu, "person.insurance_number"],
  [/postleitzahl|\bplz\b/iu, "address.postcode"],
  [/stra(?:ß|ss)e|gasse/iu, "address.street"],
  [/hausnummer|stiege|\btür\b/iu, "address.building_unit"],
  [/\bort\b|wohnort/iu, "address.city"],
  [/telefon/iu, "contact.phone"],
  [/e-?mail/iu, "contact.email"],
];

/** Which administrative question a field answers, by fact type or (detected forms) by label. */
export function questionKey(field: FormField): string | undefined {
  if (!writableField(field)) return;
  if (field.fact_type && QUESTIONS[field.fact_type]) return field.fact_type;
  if (field.fact_type && !field.fact_type.startsWith("form.field.")) return;
  const label = `${field.label_de} ${field.help_text ?? ""}`;
  return LABEL_KEYS.find(([pattern]) => pattern.test(label))?.[1];
}

/**
 * Fields the pilot asks for one by one: the known administrative ones, and every other
 * applicant-writable text field by its label. Checkboxes and provider sections are not asked.
 */
export function askable(field: FormField): boolean {
  if (questionKey(field) !== undefined) return true;
  return (
    writableField(field) &&
    field.type !== "checkbox" &&
    cleanLabel(field.label_de).length > 1 &&
    !/^(?:datum|date|ort,? datum)$/iu.test(cleanLabel(field.label_de))
  );
}

/** A form label without technical suffixes ("Bei welcher Anstalt2" → "Bei welcher Anstalt"). */
export function cleanLabel(label: string): string {
  return label
    .replace(/[_\s]*\d+$/u, "")
    .replace(/_/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const RELATIVES: Readonly<Record<string, { de: string; en: string }>> = {
  mutter: { de: "Ihrer Mutter", en: "your mother" },
  mama: { de: "Ihrer Mutter", en: "your mother" },
  vater: { de: "Ihres Vaters", en: "your father" },
  papa: { de: "Ihres Vaters", en: "your father" },
  oma: { de: "Ihrer Großmutter", en: "your grandmother" },
  großmutter: { de: "Ihrer Großmutter", en: "your grandmother" },
  opa: { de: "Ihres Großvaters", en: "your grandfather" },
  großvater: { de: "Ihres Großvaters", en: "your grandfather" },
  frau: { de: "Ihrer Frau", en: "your wife" },
  mann: { de: "Ihres Mannes", en: "your husband" },
  tochter: { de: "Ihrer Tochter", en: "your daughter" },
  sohn: { de: "Ihres Sohnes", en: "your son" },
};
const RELATIVE =
  /\bmeine[mnrs]?\s+(mutter|mama|vater|papa|oma|großmutter|opa|großvater|frau|mann|tochter|sohn)\b/iu;

/** Whose form it is, from the conversation ("meine Mutter" → "Ihrer Mutter"). */
export function applicantOf(texts: readonly string[], english: boolean): string {
  for (const text of texts) {
    const relative = RELATIVES[text.match(RELATIVE)?.[1]?.toLowerCase() ?? ""];
    if (relative) return english ? relative.en : relative.de;
  }
  return english ? "the applicant" : "der antragstellenden Person";
}

/** How a field is named in a spoken list ("die Telefonnummer", else its label). */
export function fieldNoun(field: FormField, english: boolean): string {
  const noun = QUESTIONS[questionKey(field) ?? ""];
  if (noun) return english ? noun.en : noun.de;
  const label = cleanLabel(english ? (field.labels?.en ?? field.label_de) : field.label_de);
  return english ? `“${label}”` : `„${label}“`;
}

/** Cleared fields keep an empty draft; they count as missing again. */
export function emptyValue(entry: { value: unknown } | undefined): boolean {
  return (
    entry === undefined ||
    entry.value === null ||
    (typeof entry.value === "string" && !entry.value.trim())
  );
}

/**
 * The cursor moves to a field (pointer and ring) just before its value is typed live, so the
 * person can follow along in the form; without a value it only points at the field.
 */
export function fieldActions(
  formInstanceId: string,
  fieldId: string,
  typed?: { value: string; provenance: Provenance },
  /** Typing time for this field; bulk fills shorten it after the first few fields. */
  budgetMs = 2_400,
): Action[] {
  const target = { kind: "form" as const, formInstanceId, fieldId };
  const point = ActionSchema.parse({
    id: randomUUID(),
    kind: "point",
    sentenceIndex: 0,
    target,
    payload: {},
  });
  return typed
    ? [
        point,
        ActionSchema.parse({
          id: randomUUID(),
          kind: "type",
          sentenceIndex: 0,
          target,
          // Long entries (medical text) are typed faster, so each field takes about two seconds.
          payload: {
            ...typed,
            pace: Math.max(
              5,
              Math.min(FORM_TYPE_PACE_MS, Math.round(budgetMs / Math.max(1, typed.value.length))),
            ),
          },
        }),
      ]
    : [point];
}

export function fieldQuestion(field: FormField, applicant: string, english: boolean): string {
  const key = questionKey(field);
  const noun = QUESTIONS[key ?? ""];
  if (!noun)
    return english
      ? `What should I enter for “${cleanLabel(field.labels?.en ?? field.label_de)}”?`
      : `Was soll ich bei „${cleanLabel(field.label_de)}“ eintragen?`;
  if (english) return `What is ${noun.en} of ${applicant}?`;
  return key === "address.building_unit"
    ? `Wie lauten Hausnummer, Stiege und Tür ${applicant}?`
    : `Wie lautet ${noun.de} ${applicant}?`;
}

const MONTHS = [
  "januar",
  "februar",
  "märz",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "dezember",
];
const MONTH_ALIASES: Readonly<Record<string, number>> = { jänner: 1, maerz: 3, feber: 2 };

function parseDate(text: string): { day: number; month: number; year: number } | undefined {
  const numeric = text.match(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/u);
  const named = text.match(/\b(\d{1,2})\.?\s+([a-zäöü]+)\s+(\d{4})\b/iu);
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/u);
  const parts = numeric
    ? { day: Number(numeric[1]), month: Number(numeric[2]), year: Number(numeric[3]) }
    : named
      ? {
          day: Number(named[1]),
          month:
            MONTHS.indexOf((named[2] ?? "").toLowerCase()) + 1 ||
            (MONTH_ALIASES[(named[2] ?? "").toLowerCase()] ?? 0),
          year: Number(named[3]),
        }
      : iso
        ? { day: Number(iso[3]), month: Number(iso[2]), year: Number(iso[1]) }
        : undefined;
  if (!parts || parts.month < 1 || parts.month > 12 || parts.day < 1) return;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (date.getUTCDate() !== parts.day || parts.year < 1900 || date > new Date()) return;
  return parts;
}

const LEAD_IN =
  /^(?:(?:also|ja|ok(?:ay)?|gut)[,\s]+)?(?:(?:sie|er|die|der|das|es|mein[e]?|ihr[e]?)\s+)?(?:\p{L}+\s+)?(?:hei(?:ß|ss)t|lautet|ist|wäre|is)\s+/iu;

const SENTENCE =
  /\b(?:hat|habe|hatte|ist|sind|war|bin|kann|braucht|leidet|bekommt|nimmt|has|is|was|needs)\b/iu;
const NAME = /^\p{L}[\p{L}'’. -]{0,60}$/u;

/** The value for one field from a short spoken or typed answer, with how to read it back. */
export function fieldValue(
  field: FormField,
  answer: string,
  english: boolean,
): { value: JsonValue; readBack: string } | undefined {
  const text = answer
    .trim()
    .replace(/[.!]+$/u, "")
    .trim();
  const key = questionKey(field);
  if (key === "person.birth_date" || field.type === "date") {
    const date = parseDate(text);
    if (!date) return;
    const pad = (value: number) => String(value).padStart(2, "0");
    const value =
      field.type === "date"
        ? `${date.year}-${pad(date.month)}-${pad(date.day)}`
        : `${pad(date.day)}.${pad(date.month)}.${date.year}`;
    // "12. März 1948" would be split into two spoken sentences after "12."; digits stay one.
    const readBack = `${pad(date.day)}.${pad(date.month)}.${date.year}`;
    return validFieldValue(field, value) ? { value, readBack } : undefined;
  }
  const stripped = text.replace(LEAD_IN, "").trim();
  const value =
    key === "person.insurance_number" || key === "address.postcode" || key === "contact.phone"
      ? stripped.replace(/(?<=\d)[\s/-]+(?=\d)/gu, "")
      : stripped;
  if (key === "person.insurance_number" && !/^\d{10}$/u.test(value)) return;
  if (key === "address.postcode" && !/^\d{4,5}$/u.test(value)) return;
  if (key === "contact.email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) return;
  // A sentence ("Sie hat Demenz") is not a field value; names stay names.
  if (SENTENCE.test(value) || value.split(/\s+/u).length > 5) return;
  if (/^person\.(?:family|given)_name$/u.test(key ?? "") && !NAME.test(value)) return;
  if (!validFieldValue(field, value)) return;
  return { value, readBack: value };
}

/**
 * How the open form is filled. Step mode (default) asks one field after the other; fast mode
 * fills everything possible at once and then names what is still missing. The person switches
 * any time; the newest wish in the conversation counts.
 */
export type FormMode = "step" | "fast";
const FAST_PHRASE =
  /\b(?:alles auf einmal|(?:alles|den rest|rest|restlichen? felder) (?:\p{L}+ ){0,2}automatisch|automatisch aus|ohne (?:viele )?(?:rück)?fragen|fast mode|all at once|(?:fill|do) (?:\p{L}+ ){0,2}automatically|the rest automatically)\b/iu;
const FAST_WORD = /\b(?:schnell(?:er)?|zügig|fast(?:er)?|quick(?:ly|er)?)\b/iu;
const STEP_PHRASE =
  /\b(?:schritt für schritt|feld für feld|einzeln|eins nach dem anderen|langsam(?:er)?|step by step|one by one|field by field|slow(?:er|ly)?)\b/iu;
const FILL_REQUEST = /ausf(?:ü|ue)ll|f(?:ü|ue)ll|eintrag|antrag|\bfill\b|apply/iu;

/** The mode a message asks for, if it asks for one. */
export function modeRequest(text: string): FormMode | undefined {
  const trimmed = text.trim();
  if (STEP_PHRASE.test(trimmed) && trimmed.length <= 160) return "step";
  if (FAST_PHRASE.test(trimmed)) return "fast";
  if (FAST_WORD.test(trimmed) && trimmed.length <= 60 && !trimmed.includes("?")) return "fast";
  return;
}

/** A message that hands over data (a pasted letter or several values), not a question. */
export function handsOverData(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 160 && (/\n/u.test(trimmed) || !/\?\s*$/u.test(trimmed))) return true;
  return MANY.test(trimmed) && /\d/u.test(trimmed) && !/\?\s*$/u.test(trimmed);
}

/** The person's current fill mode: the newest explicit wish, or a letter pasted with the request. */
export function formMode(userTexts: readonly string[]): FormMode {
  for (const text of [...userTexts].reverse()) {
    const requested = modeRequest(text);
    if (requested) return requested;
    if (handsOverData(text) && FILL_REQUEST.test(text)) return "fast";
  }
  return "step";
}

/** User texts of the conversation, oldest first. */
export function userTexts(history: readonly LotseMessage[]): string[] {
  return history.flatMap((message) =>
    message.role === "user"
      ? [message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")]
      : [],
  );
}

const QuestionMetadata = z.object({
  formQuestion: z.object({ formInstanceId: z.uuid(), fieldId: z.string().min(1) }),
});

/** The form field the last assistant message asked for, if any. */
export function pendingFormQuestion(
  history: readonly LotseMessage[],
): { formInstanceId: string; fieldId: string } | undefined {
  const assistant = history.findLast((message) => message.role === "assistant");
  const parsed = QuestionMetadata.safeParse(assistant?.metadata);
  return parsed.success ? parsed.data.formQuestion : undefined;
}

const SKIP = /^(?:überspringen|weiter|weiß (?:ich )?nicht|keine ahnung|skip|i don'?t know)\b/iu;
const copy = {
  de: {
    filled: (value: string) => `Danke, eingetragen: ${value}.`,
    filledMany: (values: string) => `Danke, eingetragen: ${values}.`,
    unclear: "Das habe ich nicht sicher verstanden.",
    skipped: "Gut, das lasse ich leer.",
    done: "Die Felder, die ich erfragen kann, sind eingetragen. Bitte prüfen Sie den Entwurf; abgeschickt wird nichts.",
    invite:
      "Das Formular ist offen, abgeschickt wird nichts. Haben Sie Unterlagen oder Angaben dazu, etwa einen Brief vom Spital? Sie können mir alles auf einmal sagen, einen Brief einfügen oder hochladen – oder wir gehen Feld für Feld durch.",
    first: (question: string) => `Zuerst: ${question}`,
    openedFilled: (count: number) =>
      `Das Formular ist offen. Ich habe ${count} ${count === 1 ? "Feld" : "Felder"} aus Ihren Angaben eingetragen; abgeschickt wird nichts.`,
    stillMissing: (names: string) => `Es fehlen noch: ${names}.`,
    stepOffer: (question: string) =>
      `Wenn Sie möchten, gehen wir das Schritt für Schritt durch – zuerst: ${question}`,
    stepMode: "Gut, wir gehen Feld für Feld durch.",
    fastNothing:
      "Aus Ihren bisherigen Angaben kann ich nichts weiter eintragen. Sagen Sie mir einfach alles auf einmal oder fügen Sie einen Brief ein.",
    and: "und",
    review: "Bitte prüfen Sie den Entwurf.",
  },
  en: {
    filled: (value: string) => `Thanks, filled in: ${value}.`,
    filledMany: (values: string) => `Thanks, filled in: ${values}.`,
    unclear: "I did not catch that for sure.",
    skipped: "Fine, I will leave that empty.",
    done: "The fields I can ask for are filled in. Please review the draft; nothing is submitted.",
    invite:
      "The form is open; nothing is submitted. Do you have any documents or details for it, such as a letter from the hospital? You can tell me everything at once, paste or upload a letter – or we go through it field by field.",
    first: (question: string) => `First: ${question}`,
    openedFilled: (count: number) =>
      `The form is open. I filled in ${count} ${count === 1 ? "field" : "fields"} from your details; nothing is submitted.`,
    stillMissing: (names: string) => `Still missing: ${names}.`,
    stepOffer: (question: string) =>
      `If you like, we go through them step by step – first: ${question}`,
    stepMode: "Fine, we go through it field by field.",
    fastNothing:
      "I cannot fill in anything else from what you told me so far. Just tell me everything at once or paste a letter.",
    and: "and",
    review: "Please review the draft.",
  },
} as const;

export interface FormAnswer {
  text: string;
  actions: Action[];
  next?: { formInstanceId: string; fieldId: string };
}

/**
 * A short answer to the pending form question fills that field as the user's own statement
 * (confirmed fact with provenance, draft field), is typed into the viewer and read back, and
 * the next missing field is asked for. Anything else is left to the agent.
 */
export async function answerFormQuestion(input: {
  db: DatabaseClient;
  context: RuntimeContext;
  history: readonly LotseMessage[];
  userText: string;
  turnId: string;
  language: string;
  topics: readonly string[];
  model?: LanguageModel;
}): Promise<FormAnswer | undefined> {
  const { db, context } = input;
  const answer = input.userText.trim();
  if (!answer) return;
  if (context.actorRole !== "subject" || context.autonomyLevel === "L1") return;
  const pending = pendingFormQuestion(input.history.slice(0, -1));
  const fromDocuments = DOCUMENT.test(answer);
  if (!pending) {
    // A form is open and the person hands over data (typed or "from the letter"): fill it directly.
    const data =
      ((answer.length > 40 || MANY.test(answer)) && !asksQuestion(answer)) ||
      (FIELD_HINT.test(answer) && !asksQuestion(answer));
    if (!(fromDocuments || data)) return;
    const [latest] = await db
      .select({ id: formInstances.id })
      .from(formInstances)
      .where(
        and(
          eq(formInstances.caseId, context.caseId),
          eq(formInstances.subjectId, context.subjectId),
        ),
      )
      .orderBy(desc(formInstances.createdAt))
      .limit(1);
    if (!latest) return;
    return answerManyFields({
      ...input,
      pending: { formInstanceId: latest.id, fieldId: "" },
      answer,
      fromDocuments,
      mode: formMode(userTexts(input.history)),
    });
  }
  if (
    !asksQuestion(answer) &&
    (answer.length > 80 ||
      MANY.test(answer) ||
      fromDocuments ||
      CORRECTION.test(answer) ||
      FIELD_HINT.test(answer))
  )
    return answerManyFields({
      ...input,
      pending,
      answer,
      fromDocuments,
      mode: formMode(userTexts(input.history)),
    });
  if (answer.includes("?")) return;
  const [instance] = await db
    .select()
    .from(formInstances)
    .where(
      and(
        eq(formInstances.id, pending.formInstanceId),
        eq(formInstances.caseId, context.caseId),
        eq(formInstances.subjectId, context.subjectId),
      ),
    );
  if (!instance) return;
  const fields = templateSchema(await getTemplate(db, instance.templateId)).fields;
  const index = fields.findIndex((field) => field.id === pending.fieldId);
  const field = fields[index];
  if (!field || !askable(field)) return;
  // "Maria Beispiel" to a name question fills given and family name separately.
  const nameKeys = ["person.family_name", "person.given_name"];
  if (
    nameKeys.includes(questionKey(field) ?? "") &&
    nameKeys.every((key) => fields.some((candidate) => questionKey(candidate) === key)) &&
    /^\p{Lu}[\p{L}'-]+\s+\p{Lu}[\p{L}'-]+$/u.test(answer.replace(LEAD_IN, "").trim())
  ) {
    const many = await answerManyFields({
      ...input,
      pending,
      answer,
      mode: formMode(userTexts(input.history)),
      only: nameKeys,
    });
    if (many) return many;
  }
  const english = input.language.startsWith("en");
  const strings = english ? copy.en : copy.de;
  const applicant = applicantOf(input.topics, english);
  const values = formFields.parse(instance.fields);
  const skipped = SKIP.test(answer);
  const parsed = skipped ? undefined : fieldValue(field, answer, english);
  if (!skipped && !parsed)
    return {
      text: `${strings.unclear} ${fieldQuestion(field, applicant, english)}`,
      actions: [],
      next: pending,
    };
  const actions: Action[] = [];
  let lead: string = strings.skipped;
  if (parsed) {
    const source = { kind: "statement" as const, turnId: input.turnId, quote: answer };
    const factId = randomUUID();
    const provenance = { factId, source };
    await db.transaction(async (tx) => {
      await tx.insert(facts).values({
        id: factId,
        subjectId: context.subjectId,
        type: field.fact_type ?? `form.field.${instance.templateId}.${field.id}`,
        value: parsed.value,
        turnId: input.turnId,
        source,
        confidence: 1,
        confirmed: true,
      });
      await tx
        .update(formInstances)
        .set({
          fields: formFields.parse({
            ...values,
            [field.id]: { value: parsed.value, provenance, state: "draft", approvalId: null },
          }),
        })
        .where(eq(formInstances.id, instance.id));
    });
    actions.push(
      ...fieldActions(instance.id, field.id, { value: String(parsed.value), provenance }),
    );
    lead = strings.filled(parsed.readBack);
  }
  const next = fields.find(
    (candidate, position) =>
      position > index && askable(candidate) && emptyValue(values[candidate.id]),
  );
  if (next) actions.push(...fieldActions(instance.id, next.id));
  return {
    text: `${lead} ${next ? fieldQuestion(next, applicant, english) : strings.done}`,
    actions,
    ...(next ? { next: { formInstanceId: instance.id, fieldId: next.id } } : {}),
  };
}

/**
 * A question for the agent, not data for the form: it ends with "?", or is a short message with
 * a question mark or a question word. A pasted block of values with a "?" inside stays data.
 */
export function asksQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (/\?\s*$/u.test(trimmed)) return true;
  if (trimmed.length > 160 || /\n/u.test(trimmed)) return false;
  return (
    trimmed.includes("?") ||
    /^(?:wie|was|warum|wieso|weshalb|wann|wo|wer|welche[rsmn]?|kann|könnte|darf|muss|soll|brauche|gibt es|how|what|why|when|where|who|which|can|could|should|do|does|is|are)\b/iu.test(
      trimmed,
    )
  );
}

// Several values in one message ("Maria Müller, geb. 12.3.1948, Hauptstraße 5, 1100 Wien").
const MANY = /[\n;]|,.*,|:\s*\S.*:/u;
// Naming a field or asking for a change targets the open form even in a short message.
const FIELD_HINT =
  /\b(?:namens?|namen|name|vorname|nachname|familienname|geburt\w*|adress\w*|anschrift|stra(?:ß|ss)e|plz|postleitzahl|ort|telefon\w*|handy\w*|mobil\w*|e-?mail\w*|versicherungsnummer|svnr|patient\w*)\b/iu;
const CORRECTION = /(?:ändere|änder|ersetze|korrigier|statt|replace|change)/iu;
const DOCUMENT = /brief|dokument|entlassung|befund|bescheid|unterlage|letter|document|daraus/iu;
const extraction = z.object({
  values: z.array(
    z.object({
      fieldId: z.string(),
      value: z.string(),
      quote: z.string(),
      factId: z.string().nullable(),
      documentId: z.string().nullable(),
      page: z.number().int().nullable(),
    }),
  ),
});

/**
 * Several values in one message fill every matching askable field at once. A model maps the
 * person's own text onto the open fields; each value still passes the field's own validation, is
 * stored as the person's statement and typed live. Nothing matched leaves the turn to the agent.
 */
export async function answerManyFields(input: {
  db: DatabaseClient;
  context: RuntimeContext;
  turnId: string;
  language: string;
  topics: readonly string[];
  model?: LanguageModel;
  pending: { formInstanceId: string; fieldId: string };
  answer: string;
  fromDocuments?: boolean;
  /** Fast mode names everything still missing at once instead of asking only the next field. */
  mode?: FormMode;
  /** Restricts the mapping to fields with these meanings (e.g. both name fields). */
  only?: readonly string[];
}): Promise<FormAnswer | undefined> {
  const { db, context, pending, answer } = input;
  if (!input.model) return;
  const [instance] = await db
    .select()
    .from(formInstances)
    .where(
      and(
        eq(formInstances.id, pending.formInstanceId),
        eq(formInstances.caseId, context.caseId),
        eq(formInstances.subjectId, context.subjectId),
      ),
    );
  if (!instance) return;
  const fields = templateSchema(await getTemplate(db, instance.templateId)).fields;
  const values = formFields.parse(instance.fields);
  // Empty fields and the person's own drafts can be (re)filled; confirmed values stay untouched.
  // Every applicant-writable field; doctor and hospital sections are excluded by writableField.
  // The owner allows every non-signature field, including the doctor's part, as long as each
  // value is quoted from the person's text or document with its source.
  const open = fields.filter(
    (field) =>
      field.signature === "none" &&
      field.type !== "signature" &&
      values[field.id]?.state !== "confirmed" &&
      (!input.only || input.only.includes(questionKey(field) ?? field.fact_type ?? "")),
  );
  if (!open.length) return;
  const english = input.language.startsWith("en");
  // Administrative facts already read from the person's documents (e.g. a discharge letter).
  // Everything the person already provided: document facts and their own confirmed statements
  // from earlier messages or chats (e.g. a letter pasted before), each with its source quote.
  const documentFacts = input.fromDocuments
    ? (
        await db
          .select({
            id: facts.id,
            type: facts.type,
            value: facts.value,
            source: facts.source,
            confirmed: facts.confirmed,
          })
          .from(facts)
          .where(eq(facts.subjectId, context.subjectId))
      ).filter(
        (fact) => fact.confirmed || (fact.source as { kind?: string } | null)?.kind === "document",
      )
    : [];
  // The person's newest uploaded documents (OCR text per page), so values are quoted from them
  // with document and page even before any extracted fact was confirmed.
  const documentTexts = input.fromDocuments
    ? (
        await db
          .select({ id: documents.id, pages: documents.pages })
          .from(documents)
          .where(
            and(eq(documents.subjectId, context.subjectId), eq(documents.ocrStatus, "completed")),
          )
          .orderBy(desc(documents.createdAt))
          .limit(2)
      ).map((document) => ({
        documentId: document.id,
        pages: (document.pages as { page?: number; text?: string }[])
          .filter((page) => typeof page.text === "string" && page.text.trim())
          .slice(0, 6)
          .map((page) => ({ page: page.page ?? 1, text: (page.text ?? "").slice(0, 4_000) })),
      }))
    : [];
  const result = await generateText({
    model: input.model,
    output: Output.object({ schema: extraction }),
    system:
      "Fill an application form for the person concerned (the patient) from the given text, which " +
      "may be a pasted letter such as a hospital discharge letter, and from knownFacts (what the " +
      "person provided earlier, with quotes). Use knownFacts even when the text itself has no data. For each form field whose meaning matches a value stated in the text, return it: " +
      "the full name for name fields (person.name, insured.name), only the first name for Vorname, " +
      "only the surname for Familienname/Nachname, " +
      "date of birth as DD.MM.YYYY, insurance number as 10 digits without spaces, the patient's own " +
      "address and phone only if stated as theirs. Copy values as written; never guess. Never use " +
      "names, addresses or phone numbers of hospitals, clinics, doctors or nurses. " +
      "Medical fields (diagnosis, findings, proposed measure, justification) may be filled, but only " +
      "with statements taken from the text, copied or minimally shortened, never invented or " +
      "interpreted beyond it. Tick a checkbox (value true) only when the text explicitly supports it " +
      "(e.g. Patientin = weiblich; a hip fracture = Bewegungs-/Stützapparat; recommended inpatient " +
      "rehabilitation = Stationäre). For a birth year field return only the year. For every value " +
      "return quote: the exact sentence of the text that supports it. " +
      "Set factId to the document fact's id when the value comes from it. When the value comes " +
      "from one of documents, set documentId and page and quote the exact line from that page; " +
      "otherwise set both to null.",
    prompt: JSON.stringify({
      fields: open.map((field) => ({
        fieldId: field.id,
        label: field.label_de,
        meaning: field.fact_type?.startsWith("form.field.") ? questionKey(field) : field.fact_type,
      })),
      text: answer,
      documents: documentTexts,
      knownFacts: documentFacts.map((fact) => ({
        id: fact.id,
        type: fact.type,
        value: fact.value,
        quote: (fact.source as { quote?: string } | null)?.quote?.slice(0, 300),
      })),
    }),
    abortSignal: AbortSignal.timeout(15_000),
    // A failed or slow extraction leaves the message to the agent instead of failing the turn.
  }).catch(() => undefined);
  if (!result) return;
  const filled = result.output.values.flatMap((item) => {
    const field = open.find((candidate) => candidate.id === item.fieldId);
    const text = item.value.trim();
    const parsed =
      field?.type === "checkbox"
        ? /^(?:true|ja|yes|x|1)$/iu.test(text) && validFieldValue(field, true)
          ? { value: true, readBack: cleanLabel(field.label_de) }
          : undefined
        : field && (questionKey(field) || identityField(field))
          ? fieldValue(field, text, english)
          : field && text && validFieldValue(field, text)
            ? { value: text, readBack: text }
            : undefined;
    const documentFact = documentFacts.find((fact) => fact.id === item.factId);
    // A document source counts only when the quote is really on that page.
    const page = documentTexts
      .find((document) => document.documentId === item.documentId)
      ?.pages.find((candidate) => candidate.page === item.page);
    const document =
      page && item.quote.trim() && squash(page.text).includes(squash(item.quote))
        ? { documentId: item.documentId as string, page: page.page }
        : undefined;
    return field && parsed ? [{ field, parsed, documentFact, document, quote: item.quote }] : [];
  });
  console.info(
    JSON.stringify({
      event: "form_fill_extract",
      open: open.length,
      proposed: result.output.values.map((item) => [item.fieldId, item.value]),
      accepted: filled.map((item) => item.field.id),
    }),
  );
  // A value already in the draft is not entered again (and not read back as new).
  const unique = filled.filter(
    (item, index) =>
      filled.findIndex((other) => other.field.id === item.field.id) === index &&
      values[item.field.id]?.value !== item.parsed.value,
  );
  if (!unique.length) return;
  const source = { kind: "statement" as const, turnId: input.turnId, quote: answer.slice(0, 500) };
  const written = unique.map((item) => ({
    ...item,
    provenance: item.documentFact
      ? { factId: item.documentFact.id, source: item.documentFact.source as Provenance["source"] }
      : item.document
        ? {
            factId: randomUUID(),
            source: {
              kind: "document" as const,
              documentId: item.document.documentId,
              page: item.document.page,
              quote: item.quote.slice(0, 500),
            },
          }
        : {
            factId: randomUUID(),
            source: { ...source, quote: item.quote.slice(0, 500) || source.quote },
          },
  }));
  await db.transaction(async (tx) => {
    for (const { field, parsed, provenance, documentFact, document } of written) {
      if (documentFact) continue;
      const type = field.fact_type ?? `form.field.${instance.templateId}.${field.id}`;
      // Read from a document: a fact of that document, still to be confirmed by the person.
      const row: typeof facts.$inferInsert = document
        ? {
            id: provenance.factId,
            subjectId: context.subjectId,
            type,
            value: parsed.value,
            documentId: document.documentId,
            source: {
              kind: "document",
              documentId: document.documentId,
              page: document.page,
              quote: provenance.source.quote ?? "",
            },
            confidence: 0.9,
            confirmed: false,
          }
        : {
            id: provenance.factId,
            subjectId: context.subjectId,
            type,
            value: parsed.value,
            turnId: input.turnId,
            source: { ...source, quote: provenance.source.quote ?? source.quote },
            confidence: 1,
            confirmed: true,
          };
      await tx.insert(facts).values(row);
    }
    await tx
      .update(formInstances)
      .set({
        fields: formFields.parse({
          ...values,
          ...Object.fromEntries(
            written.map(({ field, parsed, provenance }) => [
              field.id,
              { value: parsed.value, provenance, state: "draft", approvalId: null },
            ]),
          ),
        }),
      })
      .where(eq(formInstances.id, instance.id));
  });
  const actions = written.flatMap(({ field, parsed, provenance }, index) =>
    fieldActions(
      instance.id,
      field.id,
      { value: String(parsed.value), provenance },
      bulkBudget(index),
    ),
  );
  const done = new Set(written.map(({ field }) => field.id));
  const next = fields.find(
    (field) => askable(field) && emptyValue(values[field.id]) && !done.has(field.id),
  );
  const strings = english ? copy.en : copy.de;
  const applicant = applicantOf(input.topics, english);
  const pairs = written.map(({ field, parsed }) =>
    field.type === "checkbox"
      ? parsed.readBack
      : `${cleanLabel(english ? (field.labels?.en ?? field.label_de) : field.label_de)}: ${
          parsed.readBack.length > 40 ? `${parsed.readBack.slice(0, 37)}…` : parsed.readBack
        }`,
  );
  const lead = strings.filledMany(
    pairs.length > 6
      ? `${pairs.slice(0, 6).join(", ")} ${english ? "and" : "und"} ${pairs.length - 6} ${english ? "more" : "weitere"}`
      : pairs.join(", "),
  );
  if (next) actions.push(...fieldActions(instance.id, next.id));
  const question = next ? fieldQuestion(next, applicant, english) : strings.done;
  const missing = fields.filter(
    (field) => askable(field) && emptyValue(values[field.id]) && !done.has(field.id),
  );
  return {
    text:
      input.mode === "fast" && next
        ? `${lead} ${missingSentence(missing, english)} ${strings.stepOffer(question)}`
        : `${lead} ${question}`,
    actions,
    ...(next ? { next: { formInstanceId: instance.id, fieldId: next.id } } : {}),
  };
}

function squash(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

/** Bulk fills type the first fields visibly, the rest quickly, so typing ends with the turn. */
export function bulkBudget(index: number): number {
  return index < 5 ? 1_500 : 250;
}

export function missingSentence(missing: readonly FormField[], english: boolean): string {
  const strings = english ? copy.en : copy.de;
  const names = missing.slice(0, 6).map((field) => fieldNoun(field, english));
  const rest = missing.length - names.length;
  const named =
    rest > 0
      ? `${names.join(", ")} ${strings.and} ${rest} ${english ? "more" : "weitere"}`
      : names.length < 2
        ? (names[0] ?? "")
        : `${names.slice(0, -1).join(", ")} ${strings.and} ${names.at(-1)}`;
  return strings.stillMissing(named);
}

/**
 * Fills a just-opened form from everything the person provided (the text handed over with the
 * request, earlier statements and document facts). Both modes prefill what is known; the mode
 * decides how the opened form is presented (see openedFormTurn).
 */
export async function fillOpenedForm(input: {
  db: DatabaseClient;
  context: RuntimeContext;
  formInstanceId: string;
  mode: FormMode;
  text: string;
  turnId: string;
  language: string;
  topics: readonly string[];
  model: LanguageModel;
}): Promise<FormAnswer | undefined> {
  return answerManyFields({
    db: input.db,
    context: input.context,
    turnId: input.turnId,
    language: input.language,
    topics: input.topics,
    model: input.model,
    pending: { formInstanceId: input.formInstanceId, fieldId: "" },
    answer: input.text,
    fromDocuments: true,
    mode: input.mode,
  });
}

/**
 * The first turn once the form popup is open. Without handed-over data (step mode) one short
 * sentence invites the person to tell everything or go field by field, and the cursor moves to
 * the first missing field. With data or in fast mode every filled field is typed live with the
 * cursor, and what is still missing is named in one sentence.
 */
export async function openedFormTurn(input: {
  db: DatabaseClient;
  context: RuntimeContext;
  formInstanceId: string;
  history: readonly LotseMessage[];
  topics: readonly string[];
  language: string;
}): Promise<FormAnswer | undefined> {
  const [instance] = await input.db
    .select()
    .from(formInstances)
    .where(
      and(
        eq(formInstances.id, input.formInstanceId),
        eq(formInstances.caseId, input.context.caseId),
      ),
    );
  if (!instance) return;
  const fields = templateSchema(await getTemplate(input.db, instance.templateId)).fields;
  const values = formFields.parse(instance.fields);
  const english = input.language.startsWith("en");
  const strings = english ? copy.en : copy.de;
  const applicant = applicantOf(input.topics, english);
  const texts = userTexts(input.history);
  const mode = formMode(texts);
  const handedOver = handsOverData(texts.at(-1) ?? "");
  const missing = fields.filter((field) => askable(field) && emptyValue(values[field.id]));
  const next = missing[0];
  const question = next ? fieldQuestion(next, applicant, english) : strings.done;
  const pointNext = next ? fieldActions(instance.id, next.id) : [];
  const filled = fields.filter(
    (field) =>
      !emptyValue(values[field.id]) &&
      values[field.id]?.value !== false &&
      values[field.id]?.state === "draft",
  );
  const result = (text: string, actions: Action[]): FormAnswer => ({
    text,
    actions,
    ...(next ? { next: { formInstanceId: instance.id, fieldId: next.id } } : {}),
  });
  if (mode === "step" && !handedOver)
    return result(`${strings.invite} ${strings.first(question)}`, pointNext);
  const typed = filled.flatMap((field, index) => {
    const entry = values[field.id];
    const provenance = ProvenanceSchema.safeParse(entry?.provenance);
    return entry && provenance.success
      ? fieldActions(
          instance.id,
          field.id,
          { value: String(entry.value), provenance: provenance.data },
          bulkBudget(index),
        )
      : [];
  });
  if (!filled.length) return result(`${strings.invite} ${strings.first(question)}`, pointNext);
  const lead = strings.openedFilled(filled.length);
  if (!next) return result(`${lead} ${strings.review}`, typed);
  return result(
    mode === "fast"
      ? `${lead} ${missingSentence(missing, english)} ${strings.stepOffer(question)}`
      : `${lead} ${question}`,
    [...typed, ...pointNext],
  );
}
