import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseClient } from "@lotse/db";
import { cases, formInstances, formTemplates } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import {
  type Action,
  ActionSchema,
  JsonObjectSchema,
  ProvenanceSchema,
  type Target,
} from "@lotse/protocol";
import type { LanguageModel, UIMessageStreamWriter } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import type { RuntimeContext } from "../agent/context.ts";
import { FORM_TYPE_PACE_MS } from "../config/index.ts";
import { acquireForm } from "../forms/acquire/index.ts";
import { prefillForm } from "../forms/instances/index.ts";
import { getTemplate } from "../forms/registry/index.ts";
import { type FormField, type FormToolResult, templateSchema } from "../forms/schema.ts";
import { contracts } from "../tools/contracts/index.ts";
import type { LotseMessage } from "../tools/types.ts";
import {
  answerManyFields,
  applicantOf,
  askable,
  type FormAnswer,
  fieldQuestion,
} from "./form-answers.ts";

export interface BenefitForm {
  formId: string;
  goal: string;
}

/** Original SV-Box assets of the registered forms (see packages/evals/sets/e7/forms.json). */
const FORM_ASSETS: Readonly<
  Record<string, { file: string; pages: number; publisher: string; title: string }>
> = {
  "svbox-pflegegeld": {
    file: "PAL080_0125_Mpfl_052026.pdf",
    pages: 8,
    publisher: "https://www.pv.at",
    title: "Antrag auf Pflegegeld (PVA)",
  },
  "svbox-fahrtkosten-wien": {
    file: "Antrag-auf-Zuschuss-zu-Fahrtkosten_Wien.pdf",
    pages: 2,
    publisher: "https://www.oegk.at",
    title: "Antrag auf Zuschuss zu Fahrtkosten (ÖGK Wien)",
  },
  "svbox-reha-unfall": {
    file: "Reha_n_Unfall_052026.pdf",
    pages: 2,
    publisher: "https://www.pv.at",
    title: "Antrag auf Rehabilitation nach Unfall (PVA)",
  },
  "svbox-kur-reha": {
    file: "Antrag Kur und Reha.pdf",
    pages: 2,
    publisher: "https://www.oegk.at",
    title: "Antrag auf Kur und Rehabilitation (ÖGK)",
  },
  "svbox-senioren-wg": {
    file: "Bedarfsmeldung-Senior_innen-Wohngemeinschaft_Basispaket.1736522017.pdf",
    pages: 2,
    publisher: "https://www.fsw.at",
    title: "Bedarfsmeldung Senior*innen-Wohngemeinschaft (FSW)",
  },
  "svbox-fsw-foerderung": {
    file: "fsw-antrag-auf-foerderung-von-leistungen.1779095804.pdf",
    pages: 13,
    publisher: "https://www.fsw.at",
    title: "Antrag auf Förderung von Leistungen (FSW)",
  },
  "svbox-einrichtungswunsch": {
    file: "FSW-Antrag-Beilage-Einrichtungswunsch.1779345450.pdf",
    pages: 2,
    publisher: "https://www.fsw.at",
    title: "Beilage Einrichtungswunsch (FSW)",
  },
};

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

/** The page the last assistant message opened, while no form was prepared in it yet. */
export function openedPageUrl(history: readonly LotseMessage[]): string | undefined {
  const last = history.at(-1);
  if (last?.role !== "assistant") return;
  if (last.parts.some((part) => part.type === "tool-form.prefill")) return;
  for (const part of last.parts) {
    const output = toolOutput(part, "tool-ui.openResource") as { success?: unknown } | undefined;
    const target =
      "input" in part ? (part.input as { target?: Target } | undefined)?.target : undefined;
    if (output?.success === true && target?.kind === "dom") return target.url;
  }
  return;
}

export function openedPageWithoutForm(history: readonly LotseMessage[]): boolean {
  return openedPageUrl(history) !== undefined;
}

function pdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/** The prefill output of the form prepared in the last assistant message, once its open settled. */
export function preparedFormAwaitingQuestion(
  history: readonly LotseMessage[],
): { formInstanceId: string; proposals: Proposal[]; missingFields: string[] } | undefined {
  const last = history.at(-1);
  if (last?.role !== "assistant") return;
  const index = last.parts.findIndex((part) => part.type === "tool-form.prefill");
  if (index < 0) return;
  const after = last.parts.slice(index + 1);
  if (after.some((part) => part.type === "text")) return;
  const opened = after.findLast((part) => part.type === "tool-ui.openResource");
  if (
    !opened ||
    !("state" in opened) ||
    !["output-available", "output-error"].includes(opened.state)
  )
    return;
  const parsed = contracts["form.prefill"].output.safeParse(
    toolOutput(last.parts[index] as Part, "tool-form.prefill"),
  );
  return parsed.success ? parsed.data : undefined;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

async function findTemplate(db: DatabaseClient, formId: string, source: string) {
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(sql`${formTemplates.schema}->>'id' = ${formId} OR ${formTemplates.source} = ${source}`)
    .orderBy(desc(formTemplates.retrievedAt))
    .limit(1);
  return template;
}

async function localAsset(formId: string, file: string) {
  if (process.env.NODE_ENV === "production" && !process.env.SVBOX_DIR) return;
  const root = resolve(repositoryRoot, process.env.SVBOX_DIR ?? "data/svbox");
  try {
    const [bytes, raw] = await Promise.all([
      readFile(/* turbopackIgnore: true */ resolve(root, "Anträge und Formulare", file)),
      readFile(
        /* turbopackIgnore: true */ resolve(
          repositoryRoot,
          "packages/knowledge/forms",
          `${formId}.json`,
        ),
        "utf8",
      ),
    ]);
    return { bytes, record: JsonObjectSchema.parse(JSON.parse(raw)) };
  } catch {
    return;
  }
}

/**
 * The registered template for a form id. Where the SV-Box asset is mounted (development or
 * SVBOX_DIR), a missing template is registered from the knowledge schema and its asset is
 * stored for the viewer.
 */
export async function registeredTemplate(db: DatabaseClient, formId: string) {
  const asset = FORM_ASSETS[formId];
  if (!asset) return;
  const source = `svbox:Anträge und Formulare/${asset.file}`;
  const existing = await findTemplate(db, formId, source);
  const local = await localAsset(formId, asset.file);
  if (!local) return existing;
  const hash = createHash("sha256").update(local.bytes).digest("hex");
  if (existing && existing.hash !== hash) return existing;
  const storageKey = existing?.storageKey ?? `forms/original/${hash}.pdf`;
  const storage = createObjectStorage();
  try {
    await storage.put(storageKey, local.bytes, "application/pdf");
  } finally {
    storage.close();
  }
  if (existing) return existing;
  await db
    .insert(formTemplates)
    .values({
      ...(typeof local.record.template_id === "string" ? { id: local.record.template_id } : {}),
      title: asset.title,
      publisher: asset.publisher,
      source,
      hash,
      format: "acroform",
      pages: asset.pages,
      status: "auto",
      schema: local.record,
      storageKey,
    })
    .onConflictDoNothing();
  return findTemplate(db, formId, source);
}

const copy = {
  de: {
    opened: (title: string, filled: number) =>
      filled > 0
        ? `Ich habe das Formular „${title}“ geöffnet und ${filled} ${filled === 1 ? "Feld" : "Felder"} aus Ihren bestätigten Angaben eingetragen. Abgeschickt wird nichts.`
        : `Ich habe das Formular „${title}“ geöffnet. Abgeschickt wird nichts.`,
    done: "Die Felder, die ich aus Ihren Angaben kenne, sind eingetragen. Bitte prüfen Sie den Entwurf.",
  },
  en: {
    opened: (title: string, filled: number) =>
      filled > 0
        ? `I opened the form “${title}” and filled ${filled} ${filled === 1 ? "field" : "fields"} from your confirmed details. Nothing is submitted.`
        : `I opened the form “${title}”. Nothing is submitted.`,
    done: "The fields I know from your details are filled in. Please review the draft.",
  },
} as const;

type Proposal = FormToolResult<"form.prefill">["proposals"][number];

/**
 * After the user agreed to open an official page, a registered form for the same benefit is
 * prepared as a draft (L3): goal confirmed, prefilled from confirmed facts and opened in the viewer.
 * The question follows once the viewer reports back. Nothing is submitted.
 */
export async function prepareFormAfterOpen(input: {
  db: DatabaseClient;
  context: RuntimeContext;
  history: readonly LotseMessage[];
  writer: Pick<UIMessageStreamWriter<LotseMessage>, "write">;
  signal?: AbortSignal;
  /** The person asked to fill in or apply; open the registered form without a page first. */
  requested?: boolean;
  /** Data the person handed over with the request (e.g. a pasted letter), filled in right away. */
  data?: { text: string; turnId: string; language: string; model: LanguageModel };
}): Promise<{ goalConfirmed?: string } | undefined> {
  const { db, context } = input;
  if (context.actorRole !== "subject" || context.autonomyLevel === "L1") return;
  const url = openedPageUrl(input.history);
  if (!url && !input.requested) return;
  const benefit = benefitForm(topicTexts(input.history));
  // An official PDF form outside the registry is acquired (allowlist, size cap) and detected.
  const template =
    (benefit ? await registeredTemplate(db, benefit.formId) : undefined) ??
    (url && pdfUrl(url)
      ? await acquireForm(db, url, input.signal).catch(() => undefined)
      : undefined);
  if (!template) return;
  if (!url) {
    const [existing] = await db
      .select({ id: formInstances.id })
      .from(formInstances)
      .where(
        and(eq(formInstances.caseId, context.caseId), eq(formInstances.templateId, template.id)),
      )
      .limit(1);
    if (existing) return;
  }
  const [record] = await db
    .select({ confirmedGoal: cases.confirmedGoal })
    .from(cases)
    .where(eq(cases.id, context.caseId));
  const goalConfirmed = record?.confirmedGoal
    ? undefined
    : (benefit?.goal ?? `${template.title} vorbereiten`);
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
  if (input.data && input.data.text.length > 80)
    await answerManyFields({
      db,
      context,
      turnId: input.data.turnId,
      language: input.data.language,
      topics: topicTexts(input.history),
      model: input.data.model,
      pending: { formInstanceId: prefilled.formInstanceId, fieldId: "" },
      answer: input.data.text,
      fromDocuments: true,
    });
  const schema = templateSchema(await getTemplate(db, template.id));
  const firstField =
    askedField(schema.fields, prefilled.missingFields)?.id ??
    prefilled.proposals[0]?.fieldId ??
    schema.fields[0]?.id;
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
  return goalConfirmed ? { goalConfirmed } : {};
}

function askedField(fields: readonly FormField[], missingFields: readonly string[]) {
  const missing = new Set(missingFields);
  return fields.find((field) => missing.has(field.id) && askable(field));
}

/** Once the viewer is open: type the prefilled fields and ask for exactly one missing field. */
export async function formQuestion(input: {
  db: DatabaseClient;
  context: RuntimeContext;
  history: readonly LotseMessage[];
  language: string;
}): Promise<FormAnswer | undefined> {
  const prepared = preparedFormAwaitingQuestion(input.history);
  if (!prepared) return;
  const [instance] = await input.db
    .select({ templateId: formInstances.templateId })
    .from(formInstances)
    .where(
      and(
        eq(formInstances.id, prepared.formInstanceId),
        eq(formInstances.caseId, input.context.caseId),
      ),
    );
  if (!instance) return;
  const template = await getTemplate(input.db, instance.templateId);
  const asked = askedField(templateSchema(template).fields, prepared.missingFields);
  const actions = prepared.proposals.map((proposal) =>
    ActionSchema.parse({
      id: randomUUID(),
      kind: "type",
      sentenceIndex: 0,
      target: { kind: "form", formInstanceId: prepared.formInstanceId, fieldId: proposal.fieldId },
      payload: {
        value: String(proposal.value),
        provenance: ProvenanceSchema.parse(proposal.provenance),
        pace: FORM_TYPE_PACE_MS,
      },
    }),
  );
  const english = input.language.startsWith("en");
  const strings = english ? copy.en : copy.de;
  const question = asked
    ? fieldQuestion(asked, applicantOf(topicTexts(input.history), english), english)
    : strings.done;
  return {
    text: `${strings.opened(template.title, prepared.proposals.length)} ${question}`,
    actions,
    ...(asked ? { next: { formInstanceId: prepared.formInstanceId, fieldId: asked.id } } : {}),
  };
}
