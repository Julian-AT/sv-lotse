import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { facts, formFields, formInstances } from "@lotse/db/schema";
import type { JsonValue } from "@lotse/protocol";
import { and, desc, eq } from "drizzle-orm";
import type { RuntimeContext } from "../agent/context.ts";
import { identityField, validFieldValue } from "../forms/policy.ts";
import { getTemplate } from "../forms/registry/index.ts";
import { type FormField, templateSchema } from "../forms/schema.ts";
import type { LotseMessage } from "../tools/types.ts";
import {
  applicantOf,
  askable,
  emptyValue,
  type FormAnswer,
  fieldActions,
  fieldNoun,
  fieldQuestion,
  fieldValue,
  pendingFormQuestion,
  questionKey,
} from "./form-answers.ts";

/** A deterministic edit of the open form, spoken or typed. */
export type FormEditCommand =
  | { kind: "set"; field: string; value: string; force: boolean }
  | { kind: "clear"; field: string; force: boolean }
  | { kind: "next" }
  | { kind: "missing" }
  | { kind: "read" };

// Explicit permission to change a field the person already confirmed.
const FORCE =
  /\s*,?\s*\b(?:trotzdem|dennoch|auch wenn (?:es|das|er|sie) bestätigt (?:ist|wurde)|überschreib\w*|anyway|even if (?:it is |it's )?confirmed|overwrite)\b\s*,?/giu;
const POLITE = /^(?:(?:bitte|please|ok(?:ay)?|also|und|and|gut|so|jetzt|now)[,\s]+)+/iu;
const TAIL = /(?:[,\s]+(?:bitte|please|danke|thanks))+$/iu;

const READ = [
  /^(?:kannst du |können sie )?(?:lies|lese|lesen sie)\s+(?:mir\s+|uns\s+)?(?:(?:das|den|die)\s+(?:formular|antrag|entwurf|felder|einträge|eintragungen)\s+)?(?:noch\s+)?(?:(?:ein)?mal\s+)?vor\b/iu,
  /\bwas steht (?:jetzt |schon |bisher |alles )*(?:im|in dem|auf dem) (?:formular|antrag|entwurf)\b/iu,
  /\b(?:formular|antrag|entwurf) vorlesen\b/iu,
  /^(?:can you |could you )?read (?:me |out |back )*(?:the |my |her |his )?(?:form|draft|fields|entries|it)\b/iu,
  /\bwhat(?:'s| is| does) (?:in|on) the form\b/iu,
];
const MISSING = [
  /\bwas fehlt (?:noch|denn|jetzt)?\b/iu,
  /\bwelche (?:felder|angaben|daten|einträge) fehlen\b/iu,
  /\bfehlt (?:noch )?(?:was|etwas)\b/iu,
  /\bwas (?:muss|soll|brauchen? sie|brauchst du) (?:ich )?noch\b/iu,
  /\bwhat(?:'s| is) (?:still )?missing\b/iu,
  /\bwhich fields are (?:still )?(?:missing|empty|open)\b/iu,
  /\bwhat else do you need\b/iu,
];
const NEXT =
  /^(?:(?:zum|das)\s+)?(?:nächste[ns]?|naechste[ns]?)(?:\s+feld)?$|^weiter(?:\s+(?:zum|mit dem)\s+nächsten(?:\s+feld)?)?$|^(?:the\s+)?next(?:\s+(?:field|one|question))?$|^(?:skip|überspringen|überspring\w*)(?:\s+(?:this|das|dieses feld|it))?$/iu;
const CLEAR = [
  /^(?:lösch(?:e|en)?|loesch(?:e|en)?|entfern(?:e|en)?|leere?|streich(?:e|en)?|clear|delete|remove|erase|empty)\s+(?:mir\s+)?(.+)$/iu,
  /^mach(?:e|en)?\s+(.+?)\s+leer$/iu,
  /^(.+?)\s+(?:bitte\s+)?(?:löschen|loeschen|leeren|entfernen|streichen|leer lassen|leer machen|weg)$/iu,
];
const SET = [
  /^(?:ändere?|änder|aendere?|korrigiere?|korrigier|setze?|stell(?:e)?|schreib(?:e)?|change|set|update|correct|make)\s+(.+?)\s+(?:auf|zu|in|to|into)\s+(.+)$/iu,
  /^trag(?:e|en)?\s+(?:bei|unter|für|als|in)\s+(?:(?:der|die|das|dem|den)\s+)?(\S+)\s+(.+?)\s+ein$/iu,
  /^trag(?:e|en)?\s+(.+?)\s+(?:als|bei|unter|für)\s+(?:(?:der|die|das|dem|den)\s+)?(\S+)\s+ein$/iu,
  /^(.{2,40}?)\s*(?:ist|lautet|wäre|is|should be|soll(?:te)? sein|:|=)\s+(?:jetzt\s+|nun\s+|now\s+|richtig\s+|korrekt\s+)?(.+)$/iu,
  /^(?:neue[rs]?|new|richtige[rs]?|correct)\s+(.{2,40}?)\s*[:=]?\s+(\S.*)$/iu,
];

function clean(text: string): string {
  return text
    .trim()
    .replace(/[.!]+$/u, "")
    .replace(POLITE, "")
    .replace(TAIL, "")
    .trim();
}

function unquote(value: string): string {
  return value
    .trim()
    .replace(/^[„“"'‚‘»«]+|[“”"'‘’«»]+$/gu, "")
    .replace(TAIL, "")
    .replace(/[.!]+$/u, "")
    .trim();
}

/** The edit command in a short spoken or typed message, if it is one. */
export function parseFormEdit(text: string): FormEditCommand | undefined {
  const raw = text.trim();
  if (!raw || raw.length > 160 || raw.includes("\n")) return;
  if (READ.some((pattern) => pattern.test(raw))) return { kind: "read" };
  if (MISSING.some((pattern) => pattern.test(raw))) return { kind: "missing" };
  const force = new RegExp(FORCE.source, "iu").test(raw);
  const plain = clean(
    raw
      .replace(FORCE, " ")
      .replace(/\s{2,}/gu, " ")
      .replace(/\?+$/u, ""),
  );
  if (NEXT.test(plain)) return { kind: "next" };
  if (raw.includes("?")) return;
  for (const pattern of CLEAR) {
    const match = plain.match(pattern);
    if (match?.[1]) return { kind: "clear", field: match[1].trim(), force };
  }
  for (const [index, pattern] of SET.entries()) {
    const match = plain.match(pattern);
    if (!match?.[1] || !match[2]) continue;
    // "Trag 0664… als Telefonnummer ein" names the value first.
    const [fieldText, valueText] = index === 2 ? [match[2], match[1]] : [match[1], match[2]];
    const value = unquote(valueText);
    if (value) return { kind: "set", field: fieldText.trim(), value, force };
  }
  return;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/gu, "ss")
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const ARTICLES =
  /^(?:(?:der|die|das|den|dem|des|the|my|her|his|their|meine?[mnrs]?|ihre?[mnrs]?|seine?[mnrs]?|unsere?[mnrs]?|feld|field|eintrag|angabe|wert|bei|im|in|from)\s+)+/u;

// Spoken names of a field → semantic keys in priority order; an array matches a group of fields.
const SYNONYMS: readonly [RegExp, readonly (string | readonly string[])[]][] = [
  [
    /^(?:familien|nach|zu)name|^surname|^last name|^family name/u,
    ["person.family_name", "insured.family_name"],
  ],
  [/^vorname|^first name|^given name|^forename/u, ["person.given_name", "insured.given_name"]],
  [
    /geburtsdatum|geburtstag|^geb datum|date of birth|birth ?date|birthday|^dob$/u,
    ["person.birth_date", "insured.birth_date"],
  ],
  [
    /versicherungsnummer|sv-? ?nummer|^svnr|^vsnr|e-? ?card|insurance number|social security/u,
    ["person.insurance_number", "insured.insurance_number"],
  ],
  [/^e-? ?mail|mailadresse|^email address/u, ["contact.email"]],
  [/telefon|handy|mobilnummer|rufnummer|phone|mobile|^nummer$/u, ["contact.phone"]],
  [/^(?:strasse|gasse|street)/u, ["address.street"]],
  [/hausnummer|stiege|^tuer|house number|^door/u, ["address.building_unit"]],
  [/postleitzahl|^plz|postcode|post code|^zip/u, ["address.postcode"]],
  [/^(?:wohn)?ort$|^stadt$|^city$|^town$/u, ["address.city"]],
  [
    /adresse|anschrift|^address|wohnsitz/u,
    [
      "address.full",
      ["address.street", "address.building_unit", "address.postcode", "address.city"],
      "insured.address",
    ],
  ],
  [
    /^(?:(?:voller|vollstaendiger|ganzer) )?name$|^full name$|^patient/u,
    ["person.name", ["person.family_name", "person.given_name"], "insured.name"],
  ],
];

function fieldKeys(field: FormField): string[] {
  return [field.fact_type ?? "", questionKey(field) ?? ""].filter(Boolean);
}

function labelsOf(field: FormField): string[] {
  return [field.label_de, ...Object.values(field.labels ?? {})]
    .filter((label): label is string => typeof label === "string" && label.length > 0)
    .map(normalize);
}

/** The form fields a spoken field name means, robust to label variants and German/English. */
export function resolveFields(fields: readonly FormField[], spoken: string): FormField[] {
  const query = normalize(spoken).replace(ARTICLES, "").trim();
  if (query.length < 2) return [];
  for (const [pattern, keys] of SYNONYMS) {
    if (!pattern.test(query)) continue;
    for (const key of keys) {
      const wanted = new Set(typeof key === "string" ? [key] : key);
      const found = fields.filter((field) => fieldKeys(field).some((item) => wanted.has(item)));
      if (found.length) return found;
    }
  }
  const exact = fields.filter((field) => labelsOf(field).includes(query));
  if (exact.length) return exact.slice(0, 1);
  if (query.length < 4) return [];
  const partial = fields.filter((field) =>
    labelsOf(field).some(
      (label) => label.replace(/\d+$/u, "").trim() === query || label.startsWith(`${query} `),
    ),
  );
  return partial.length === 1 ? partial : [];
}

const copy = {
  de: {
    changed: (label: string, value: string) => `Geändert: ${label} – ${value}.`,
    cleared: (labels: string) => `Gelöscht: ${labels}.`,
    confirmed: (label: string) =>
      `„${label}“ ist schon bestätigt. Wenn ich es trotzdem ändern soll, sagen Sie bitte „trotzdem“ dazu.`,
    unclear: (label: string) => `Das habe ich für „${label}“ nicht sicher verstanden.`,
    unknown: "Welches Feld meinen Sie? Sagen Sie zum Beispiel „Ändere die Telefonnummer auf …“.",
    missing: (names: string) => `Es fehlen noch: ${names}.`,
    more: (count: number) =>
      `Außerdem ${count === 1 ? "ist 1 weiteres Feld" : `sind ${count} weitere Felder`} leer.`,
    complete: "Alle Felder, die ich erfragen kann, sind ausgefüllt. Abgeschickt wird nichts.",
    empty: "Im Formular steht noch nichts.",
    reads: (entries: string) => `Im Formular steht: ${entries}.`,
    andMore: (count: number) => `Dazu ${count} weitere Einträge.`,
    ticked: "angekreuzt",
    and: "und",
    review: "Bitte prüfen Sie den Entwurf; abgeschickt wird nichts.",
  },
  en: {
    changed: (label: string, value: string) => `Changed: ${label} – ${value}.`,
    cleared: (labels: string) => `Cleared: ${labels}.`,
    confirmed: (label: string) =>
      `“${label}” is already confirmed. If I should change it anyway, please say “anyway”.`,
    unclear: (label: string) => `I did not catch the value for “${label}” for sure.`,
    unknown: "Which field do you mean? For example, say “Change the phone number to …”.",
    missing: (names: string) => `Still missing: ${names}.`,
    more: (count: number) => `${count} more ${count === 1 ? "field is" : "fields are"} empty.`,
    complete: "All fields I can ask for are filled in. Nothing is submitted.",
    empty: "The form is still empty.",
    reads: (entries: string) => `The form says: ${entries}.`,
    andMore: (count: number) => `Plus ${count} more entries.`,
    ticked: "ticked",
    and: "and",
    review: "Please review the draft; nothing is submitted.",
  },
} as const;

type Values = ReturnType<typeof formFields.parse>;

function editable(field: FormField): boolean {
  return field.signature === "none" && field.type !== "signature";
}

function list(items: readonly string[], conjunction: string): string {
  return items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

function spokenLabel(field: FormField, english: boolean): string {
  return english ? (field.labels?.en ?? field.label_de) : field.label_de;
}

function shown(field: FormField, value: JsonValue, english: boolean): string {
  if (field.type === "checkbox") return english ? copy.en.ticked : copy.de.ticked;
  const text = String(value).replace(/\s+/gu, " ").trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function checkboxValue(text: string): boolean | undefined {
  if (/^(?:ja|yes|x|true|1|an|ankreuzen|angekreuzt|tick(?:ed)?|checked)$/iu.test(text)) return true;
  if (/^(?:nein|no|false|0|aus|leer|unchecked|nicht angekreuzt)$/iu.test(text)) return false;
  return;
}

function parsedValue(
  field: FormField,
  text: string,
  english: boolean,
): { value: JsonValue; readBack: string } | undefined {
  if (field.type === "checkbox") {
    const value = checkboxValue(text);
    return value === undefined || !validFieldValue(field, value)
      ? undefined
      : { value, readBack: value ? copy[english ? "en" : "de"].ticked : "–" };
  }
  if (questionKey(field) || identityField(field) || field.type === "date")
    return fieldValue(field, text, english);
  return validFieldValue(field, text) ? { value: text, readBack: text } : undefined;
}

function nextMissing(
  fields: readonly FormField[],
  values: Values,
  after: number,
  done: ReadonlySet<string> = new Set(),
): FormField | undefined {
  const open = (field: FormField) =>
    askable(field) && emptyValue(values[field.id]) && !done.has(field.id);
  return fields.find((field, index) => index > after && open(field)) ?? fields.find(open);
}

/**
 * Edit commands for the open form ("Ändere das Geburtsdatum auf …", "lösch die Adresse",
 * "nächstes Feld", "was fehlt noch?", "lies mir das Formular vor"), handled without the agent.
 * Changes are drafts with the person's statement as provenance; confirmed fields change only
 * when the person says so explicitly. Each change is typed live, read back, and the next missing
 * field is asked for. Anything that is not an edit command is left to the other handlers.
 */
export async function answerFormEdit(input: {
  db: DatabaseClient;
  context: RuntimeContext;
  history: readonly LotseMessage[];
  userText: string;
  turnId: string;
  language: string;
  topics: readonly string[];
}): Promise<FormAnswer | undefined> {
  const { db, context } = input;
  if (context.actorRole !== "subject" || context.autonomyLevel === "L1") return;
  const command = parseFormEdit(input.userText);
  if (!command) return;
  const pending = pendingFormQuestion(input.history.slice(0, -1));
  const [instance] = await db
    .select()
    .from(formInstances)
    .where(
      and(
        eq(formInstances.caseId, context.caseId),
        eq(formInstances.subjectId, context.subjectId),
        ...(pending ? [eq(formInstances.id, pending.formInstanceId)] : []),
      ),
    )
    .orderBy(desc(formInstances.createdAt))
    .limit(1);
  if (!instance) return;
  const fields = templateSchema(await getTemplate(db, instance.templateId)).fields;
  const values = formFields.parse(instance.fields);
  const english = input.language.startsWith("en");
  const strings = english ? copy.en : copy.de;
  const applicant = applicantOf(input.topics, english);
  const pendingIndex = pending ? fields.findIndex((field) => field.id === pending.fieldId) : -1;
  const ask = (lead: string, after: number, done?: ReadonlySet<string>): FormAnswer => {
    const next = nextMissing(fields, values, after, done);
    const actions = next ? fieldActions(instance.id, next.id) : [];
    return {
      text: `${lead} ${next ? fieldQuestion(next, applicant, english) : strings.complete}`.trim(),
      actions,
      ...(next ? { next: { formInstanceId: instance.id, fieldId: next.id } } : {}),
    };
  };

  if (command.kind === "next") return ask("", pendingIndex);
  if (command.kind === "missing") {
    const missing = fields.filter((field) => askable(field) && emptyValue(values[field.id]));
    const others = fields.filter(
      (field) =>
        editable(field) &&
        field.owner === "applicant" &&
        !askable(field) &&
        field.type !== "checkbox" &&
        emptyValue(values[field.id]),
    ).length;
    const names = missing.slice(0, 6).map((field) => fieldNoun(field, english));
    const lead = [
      missing.length ? strings.missing(list(names, strings.and)) : "",
      others ? strings.more(others) : "",
    ]
      .filter(Boolean)
      .join(" ");
    return ask(lead, -1);
  }
  if (command.kind === "read") {
    const filled = fields.filter(
      (field) => !emptyValue(values[field.id]) && values[field.id]?.value !== false,
    );
    if (!filled.length) return ask(strings.empty, -1);
    const entries = filled
      .slice(0, 10)
      .map(
        (field) =>
          `${spokenLabel(field, english)}: ${shown(field, values[field.id]?.value ?? "", english)}`,
      );
    const lead = [
      strings.reads(entries.join("; ")),
      filled.length > 10 ? strings.andMore(filled.length - 10) : "",
    ]
      .filter(Boolean)
      .join(" ");
    const actions = filled.slice(0, 10).flatMap((field) => fieldActions(instance.id, field.id));
    const answer = ask(lead, -1);
    return { ...answer, actions: [...actions, ...answer.actions] };
  }

  const targets = resolveFields(
    fields.filter((field) => editable(field)),
    command.field,
  );
  // An unknown field name or a value for several fields at once ("Adresse ist …") is left to the
  // mapping, which splits it onto the right fields.
  if (!targets.length || (command.kind === "set" && targets.length > 1)) return;
  const locked = targets.filter(
    (field) => values[field.id]?.state === "confirmed" && !command.force,
  );
  const changeable = targets.filter((field) => !locked.includes(field));
  const lockedLead = locked.length
    ? strings.confirmed(
        list(
          locked.map((field) => spokenLabel(field, english)),
          strings.and,
        ),
      )
    : "";
  if (!changeable.length)
    return {
      text: lockedLead,
      actions: locked.flatMap((field) => fieldActions(instance.id, field.id)),
    };
  const source = {
    kind: "statement" as const,
    turnId: input.turnId,
    quote: input.userText.trim().slice(0, 500),
  };
  if (command.kind === "set") {
    const [field] = changeable as [FormField];
    const parsed = parsedValue(field, command.value, english);
    if (!parsed)
      return {
        text: `${strings.unclear(spokenLabel(field, english))} ${fieldQuestion(field, applicant, english)}`,
        actions: fieldActions(instance.id, field.id),
        next: { formInstanceId: instance.id, fieldId: field.id },
      };
    const provenance = { factId: randomUUID(), source };
    await db.transaction(async (tx) => {
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
    values[field.id] = { value: parsed.value, provenance, state: "draft", approvalId: null };
    const answer = ask(
      `${strings.changed(spokenLabel(field, english), parsed.readBack)} ${lockedLead}`.trim(),
      fields.indexOf(field),
    );
    return {
      ...answer,
      actions: [
        ...fieldActions(instance.id, field.id, { value: String(parsed.value), provenance }),
        ...answer.actions,
      ],
    };
  }
  const provenance = { factId: randomUUID(), source };
  const cleared = Object.fromEntries(
    changeable.map((field) => [
      field.id,
      {
        value: field.type === "checkbox" ? false : "",
        provenance,
        state: "draft" as const,
        approvalId: null,
      },
    ]),
  );
  await db
    .update(formInstances)
    .set({ fields: formFields.parse({ ...values, ...cleared }) })
    .where(eq(formInstances.id, instance.id));
  Object.assign(values, cleared);
  const answer = ask(
    `${strings.cleared(
      list(
        changeable.map((field) => spokenLabel(field, english)),
        strings.and,
      ),
    )} ${lockedLead}`.trim(),
    fields.indexOf(changeable[0] as FormField) - 1,
  );
  return {
    ...answer,
    actions: [
      ...changeable.flatMap((field) =>
        fieldActions(instance.id, field.id, {
          value: field.type === "checkbox" ? "false" : "",
          provenance,
        }),
      ),
      ...answer.actions,
    ],
  };
}
