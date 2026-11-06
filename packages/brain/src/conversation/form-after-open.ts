import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { cases, formTemplates } from "@lotse/db/schema";
import { type Action, ActionSchema, ProvenanceSchema, type Target } from "@lotse/protocol";
import type { UIMessageStreamWriter } from "ai";
import { desc, eq, sql } from "drizzle-orm";
import type { RuntimeContext } from "../agent/context.ts";
import { FORM_TYPE_PACE_MS } from "../config/index.ts";
import { prefillForm } from "../forms/instances/index.ts";
import { templateSchema } from "../forms/schema.ts";
import type { LotseMessage } from "../tools/types.ts";

export interface BenefitForm {
  formId: string;
  goal: string;
}

const BENEFIT_FORMS: readonly (BenefitForm & { pattern: RegExp })[] = [
  { pattern: /pflegegeld/iu, formId: "svbox-pflegegeld", goal: "Pflegegeld beantragen" },
  {
    pattern: /fahrtkosten|krankentransport|transportkosten/iu,
    formId: "svbox-fahrtkosten-wien",
    goal: "Fahrtkostenersatz beantragen",
  },
  {
    pattern:
      /unfall\S*\s*(?:reha|rehabilitation)|(?:reha|rehabilitation)\S*\s+nach\s+(?:einem\s+)?unfall/iu,
    formId: "svbox-reha-unfall",
    goal: "Rehabilitation nach Unfall beantragen",
  },
  {
    pattern: /\bkur\b|\breha\b|rehabilitation/iu,
    formId: "svbox-kur-reha",
    goal: "Kur oder Rehabilitation beantragen",
  },
  {
    pattern: /senioren[\s-]?wg|senioren-?wohngemeinschaft/iu,
    formId: "svbox-senioren-wg",
    goal: "Platz in einer Senioren-WG beantragen",
  },
  {
    pattern: /\bfsw\b|fonds soziales wien/iu,
    formId: "svbox-fsw-foerderung",
    goal: "FSW-Förderung beantragen",
  },
  {
    pattern: /pflegeheim|heimplatz|einrichtungswunsch|pflegeeinrichtung/iu,
    formId: "svbox-einrichtungswunsch",
    goal: "Platz in einer Pflegeeinrichtung beantragen",
  },
];

/** Registered form for the benefit the conversation is about; newest text wins. */
export function benefitForm(texts: readonly string[]): BenefitForm | undefined {
  for (const text of texts) {
    const match = BENEFIT_FORMS.find((entry) => entry.pattern.test(text));
    if (match) return { formId: match.formId, goal: match.goal };
  }
  return undefined;
}

// Only administrative identity, address and contact fields are asked for; medical sections stay
// empty and are never inferred.
const ASKABLE_FACT =
  /^(?:person\.(?:family_name|given_name|birth_date|insurance_number)|address\.(?:street|building_unit|postcode|city)|contact\.(?:phone|email))$/u;

type Part = LotseMessage["parts"][number];

function toolOutput(part: Part, type: string): unknown {
  return part.type === type && "output" in part ? part.output : undefined;
}

/** Topic texts of the conversation (user messages and opened page URLs), newest first. */
export function topicTexts(history: readonly LotseMessage[]): string[] {
  return history
    .flatMap((message) =>
      message.parts.flatMap((part) => {
        if (message.role === "user" && part.type === "text") return [part.text];
        if (part.type === "tool-ui.openResource" && "input" in part)
          return [JSON.stringify(part.input)];
        return [];
      }),
    )
    .reverse();
}

/** The last assistant message opened a web page and no form was prepared in it yet. */
export function openedPageWithoutForm(history: readonly LotseMessage[]): boolean {
  const last = history.at(-1);
  if (last?.role !== "assistant") return false;
  if (last.parts.some((part) => part.type === "tool-form.prefill")) return false;
  return last.parts.some((part) => {
    const output = toolOutput(part, "tool-ui.openResource") as { success?: unknown } | undefined;
    const target =
      "input" in part ? (part.input as { target?: Target } | undefined)?.target : undefined;
    return output?.success === true && target?.kind === "dom";
  });
}

/** The continuation after the form viewer opened; the question was already asked. */
export function formAlreadyPrepared(history: readonly LotseMessage[]): boolean {
  const last = history.at(-1);
  return last?.role === "assistant" && last.parts.some((part) => part.type === "tool-form.prefill");
}

async function registeredTemplate(db: DatabaseClient, formId: string) {
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(sql`${formTemplates.schema}->>'id' = ${formId}`)
    .orderBy(desc(formTemplates.retrievedAt))
    .limit(1);
  return template;
}

const copy = {
  de: {
    opened: (title: string, filled: number) =>
      filled > 0
        ? `Ich habe das Formular „${title}“ geöffnet und ${filled} ${filled === 1 ? "Feld" : "Felder"} aus Ihren bestätigten Angaben eingetragen. Abgeschickt wird nichts.`
        : `Ich habe das Formular „${title}“ geöffnet. Abgeschickt wird nichts.`,
    ask: (label: string) => `Was soll ich im Feld „${label}“ eintragen?`,
    done: "Die Felder, die ich aus Ihren Angaben kenne, sind eingetragen. Bitte prüfen Sie den Entwurf.",
  },
  en: {
    opened: (title: string, filled: number) =>
      filled > 0
        ? `I opened the form “${title}” and filled ${filled} ${filled === 1 ? "field" : "fields"} from your confirmed details. Nothing is submitted.`
        : `I opened the form “${title}”. Nothing is submitted.`,
    ask: (label: string) => `What should I enter in the field “${label}”?`,
    done: "The fields I know from your details are filled in. Please review the draft.",
  },
} as const;

export interface FormAfterOpenResult {
  goalConfirmed?: string;
  formInstanceId: string;
  text: string;
  actions: Action[];
  askedFieldId?: string;
}

/**
 * After the user agreed to open an official page, a registered form for the same benefit is
 * prepared as a draft (L3): goal confirmed, prefilled from confirmed facts, opened in the viewer,
 * and exactly one missing administrative field is asked for. Nothing is submitted.
 */
export async function prepareFormAfterOpen(input: {
  db: DatabaseClient;
  context: RuntimeContext;
  history: readonly LotseMessage[];
  language: string;
  writer: Pick<UIMessageStreamWriter<LotseMessage>, "write">;
  signal?: AbortSignal;
}): Promise<FormAfterOpenResult | undefined> {
  const { db, context } = input;
  if (context.actorRole !== "subject" || context.autonomyLevel === "L1") return;
  if (!openedPageWithoutForm(input.history)) return;
  const benefit = benefitForm(topicTexts(input.history));
  if (!benefit) return;
  const template = await registeredTemplate(db, benefit.formId);
  if (!template) return;
  const [record] = await db
    .select({ confirmedGoal: cases.confirmedGoal })
    .from(cases)
    .where(eq(cases.id, context.caseId));
  const goalConfirmed = record?.confirmedGoal ? undefined : benefit.goal;
  if (goalConfirmed)
    await db
      .update(cases)
      .set({ confirmedGoal: goalConfirmed })
      .where(eq(cases.id, context.caseId));
  const prefillInput = {
    templateId: template.id,
    caseId: context.caseId,
    subjectId: context.subjectId,
  };
  const prefilled = await prefillForm(db, prefillInput, context, input.signal);
  const schema = templateSchema(template);
  const missing = new Set(prefilled.missingFields);
  const asked = schema.fields.find(
    (field) => missing.has(field.id) && field.fact_type && ASKABLE_FACT.test(field.fact_type),
  );
  const firstField = asked?.id ?? prefilled.proposals[0]?.fieldId ?? schema.fields[0]?.id;
  if (!firstField) return;
  const prefillCallId = randomUUID();
  input.writer.write({ type: "start-step" });
  input.writer.write({
    type: "tool-input-available",
    toolCallId: prefillCallId,
    toolName: "form.prefill",
    input: prefillInput,
  });
  input.writer.write({
    type: "tool-output-available",
    toolCallId: prefillCallId,
    output: prefilled,
  });
  input.writer.write({
    type: "tool-input-available",
    toolCallId: randomUUID(),
    toolName: "ui.openResource",
    input: {
      target: { kind: "form", formInstanceId: prefilled.formInstanceId, fieldId: firstField },
    },
  });
  const actions = prefilled.proposals.map((proposal) =>
    ActionSchema.parse({
      id: randomUUID(),
      kind: "type",
      sentenceIndex: 0,
      target: { kind: "form", formInstanceId: prefilled.formInstanceId, fieldId: proposal.fieldId },
      payload: {
        value: String(proposal.value),
        provenance: ProvenanceSchema.parse(proposal.provenance),
        pace: FORM_TYPE_PACE_MS,
      },
    }),
  );
  const strings = input.language.startsWith("en") ? copy.en : copy.de;
  const label = asked ? asked.help_text?.trim() || asked.label_de : undefined;
  const text = [
    strings.opened(template.title, prefilled.proposals.length),
    label ? strings.ask(label) : strings.done,
  ].join(" ");
  return {
    ...(goalConfirmed ? { goalConfirmed } : {}),
    formInstanceId: prefilled.formInstanceId,
    text,
    actions,
    ...(asked ? { askedFieldId: asked.id } : {}),
  };
}
