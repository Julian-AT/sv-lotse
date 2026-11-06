import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { facts, formFields, formInstances } from "@lotse/db/schema";
import { type Action, ActionSchema, type JsonValue } from "@lotse/protocol";
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

export function askable(field: FormField): boolean {
  return questionKey(field) !== undefined;
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

export function fieldQuestion(field: FormField, applicant: string, english: boolean): string {
  const key = questionKey(field);
  const noun = QUESTIONS[key ?? ""];
  if (!noun)
    return english
      ? `What should I enter for “${field.label_de}”?`
      : `Was soll ich bei „${field.label_de}“ eintragen?`;
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
  },
  en: {
    filled: (value: string) => `Thanks, filled in: ${value}.`,
    filledMany: (values: string) => `Thanks, filled in: ${values}.`,
    unclear: "I did not catch that for sure.",
    skipped: "Fine, I will leave that empty.",
    done: "The fields I can ask for are filled in. Please review the draft; nothing is submitted.",
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
      ((answer.length > 40 || MANY.test(answer)) && !answer.includes("?")) ||
      FIELD_HINT.test(answer);
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
    });
  }
  if (
    answer.length > 80 ||
    MANY.test(answer) ||
    fromDocuments ||
    CORRECTION.test(answer) ||
    FIELD_HINT.test(answer)
  )
    return answerManyFields({ ...input, pending, answer, fromDocuments });
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
      ActionSchema.parse({
        id: randomUUID(),
        kind: "type",
        sentenceIndex: 0,
        target: { kind: "form", formInstanceId: instance.id, fieldId: field.id },
        payload: { value: String(parsed.value), provenance, pace: FORM_TYPE_PACE_MS },
      }),
    );
    lead = strings.filled(parsed.readBack);
  }
  const next = fields.find(
    (candidate, position) =>
      position > index && askable(candidate) && values[candidate.id] === undefined,
  );
  return {
    text: `${lead} ${next ? fieldQuestion(next, applicant, english) : strings.done}`,
    actions,
    ...(next ? { next: { formInstanceId: instance.id, fieldId: next.id } } : {}),
  };
}

// Several values in one message ("Maria Müller, geb. 12.3.1948, Hauptstraße 5, 1100 Wien").
const MANY = /[\n;]|,.*,|:\s*\S.*:/u;
// Naming a field or asking for a change targets the open form even in a short message.
const FIELD_HINT =
  /\b(?:namens?|namen|name|vorname|nachname|familienname|geburt\w*|adresse|stra(?:ß|ss)e|plz|postleitzahl|ort|telefon|e-?mail|versicherungsnummer|svnr|patient\w*)\b/iu;
const CORRECTION = /(?:ändere|änder|ersetze|korrigier|statt|replace|change)/iu;
const DOCUMENT = /brief|dokument|entlassung|befund|bescheid|unterlage|letter|document|daraus/iu;
const extraction = z.object({
  values: z.array(
    z.object({ fieldId: z.string(), value: z.string(), factId: z.string().nullable() }),
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
  const open = fields.filter(
    (field) =>
      (field.type === "checkbox"
        ? identityField(field)
        : writableField(field) || identityField(field)) && values[field.id]?.state !== "confirmed",
  );
  if (!open.length) return;
  const english = input.language.startsWith("en");
  // Administrative facts already read from the person's documents (e.g. a discharge letter).
  const documentFacts = input.fromDocuments
    ? (
        await db
          .select({ id: facts.id, type: facts.type, value: facts.value, source: facts.source })
          .from(facts)
          .where(eq(facts.subjectId, context.subjectId))
      ).filter((fact) => (fact.source as { kind?: string } | null)?.kind === "document")
    : [];
  const result = await generateText({
    model: input.model,
    output: Output.object({ schema: extraction }),
    system:
      "Fill an application form for the person concerned (the patient) from the given text, which " +
      "may be a pasted letter such as a hospital discharge letter, and from the listed document " +
      "facts. For each form field whose meaning matches a value stated in the text, return it: " +
      "the full name for name fields (person.name, insured.name), only the first name for Vorname, " +
      "only the surname for Familienname/Nachname, " +
      "date of birth as DD.MM.YYYY, insurance number as 10 digits without spaces, the patient's own " +
      "address and phone only if stated as theirs. Copy values as written; never guess. Never use " +
      "names, addresses or phone numbers of hospitals, clinics, doctors or nurses. " +
      "Skip anything medical. For a birth year field return only the year. For the sex checkboxes " +
      "(männlich/weiblich) return true only for the one the text states (e.g. Patientin = weiblich). " +
      "Set factId to the document fact's id when the value comes from it.",
    prompt: JSON.stringify({
      fields: open.map((field) => ({
        fieldId: field.id,
        label: field.label_de,
        meaning: field.fact_type?.startsWith("form.field.") ? questionKey(field) : field.fact_type,
      })),
      text: answer,
      documentFacts: documentFacts.map((fact) => ({
        id: fact.id,
        type: fact.type,
        value: fact.value,
      })),
    }),
    abortSignal: AbortSignal.timeout(15_000),
    // A failed or slow extraction leaves the message to the agent instead of failing the turn.
  }).catch(() => undefined);
  if (!result) return;
  const filled = result.output.values.flatMap((item) => {
    const field = open.find((candidate) => candidate.id === item.fieldId);
    const parsed =
      field?.type === "checkbox"
        ? /^(?:true|ja|yes|x|1)$/iu.test(item.value.trim()) && validFieldValue(field, true)
          ? { value: true, readBack: field.label_de }
          : undefined
        : field
          ? fieldValue(field, item.value, english)
          : undefined;
    const documentFact = documentFacts.find((fact) => fact.id === item.factId);
    return field && parsed ? [{ field, parsed, documentFact }] : [];
  });
  console.info(
    JSON.stringify({
      event: "form_fill_extract",
      open: open.length,
      proposed: result.output.values.map((item) => [item.fieldId, item.value]),
      accepted: filled.map((item) => item.field.id),
    }),
  );
  const unique = filled.filter(
    (item, index) => filled.findIndex((other) => other.field.id === item.field.id) === index,
  );
  if (!unique.length) return;
  const source = { kind: "statement" as const, turnId: input.turnId, quote: answer.slice(0, 500) };
  const written = unique.map((item) => ({
    ...item,
    provenance: item.documentFact
      ? { factId: item.documentFact.id, source: item.documentFact.source as typeof source }
      : { factId: randomUUID(), source },
  }));
  await db.transaction(async (tx) => {
    for (const { field, parsed, provenance, documentFact } of written) {
      if (documentFact) continue;
      await tx.insert(facts).values({
        id: provenance.factId,
        subjectId: context.subjectId,
        type: field.fact_type ?? `form.field.${instance.templateId}.${field.id}`,
        value: parsed.value,
        turnId: input.turnId,
        source,
        confidence: 1,
        confirmed: true,
      });
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
  const actions = written.map(({ field, parsed, provenance }) =>
    ActionSchema.parse({
      id: randomUUID(),
      kind: "type",
      sentenceIndex: 0,
      target: { kind: "form", formInstanceId: instance.id, fieldId: field.id },
      payload: { value: String(parsed.value), provenance, pace: FORM_TYPE_PACE_MS },
    }),
  );
  const done = new Set(written.map(({ field }) => field.id));
  const next = fields.find(
    (field) => askable(field) && values[field.id] === undefined && !done.has(field.id),
  );
  const strings = english ? copy.en : copy.de;
  const applicant = applicantOf(input.topics, english);
  const lead = strings.filledMany(written.map(({ parsed }) => parsed.readBack).join(", "));
  return {
    text: `${lead} ${next ? fieldQuestion(next, applicant, english) : strings.done}`,
    actions,
    ...(next ? { next: { formInstanceId: instance.id, fieldId: next.id } } : {}),
  };
}
