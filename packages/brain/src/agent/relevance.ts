import { getToolName, isToolUIPart } from "ai";
import { type ToolName, toolNames } from "../tools/contracts/index.ts";
import type { LotseMessage } from "../tools/types.ts";

/** Topic groups, offered when the request, the confirmed goal or the screen mentions them. */
const GROUPS: readonly { pattern: RegExp; tools: readonly ToolName[] }[] = [
  {
    pattern:
      /formular|antrag|ausfüll|ausfuell|eintrag|feld|unterschr|beilage|unterlage|dokument|nachweis|checkliste|paket|form|fill|field|document|checklist|portal/iu,
    tools: [
      "form.find",
      "form.acquire",
      "form.analyze",
      "form.getSchema",
      "form.prefill",
      "form.commitGroup",
      "form.fillLive",
      "documents.checklist",
      "package.build",
      "docs.extractStatements",
      "ui.fill",
    ],
  },
  {
    pattern:
      /termin|ordination|arzt|ärzt|praxis|ambulanz|facharzt|buchen|vereinbar|appointment|doctor|book|clinic|wahlarzt/iu,
    tools: [
      "facility.search",
      "appointment.search",
      "appointment.prepare",
      "appointment.rehearse",
      "calendar.createEvent",
      "ui.fill",
    ],
  },
  {
    pattern:
      /wo |wohin|nähe|naehe|adresse|standort|öffnungs|oeffnungs|stelle|where|near|address|office/iu,
    tools: ["facility.search"],
  },
  {
    pattern:
      /erinner|frist|termin|bescheid|brief|schreiben|einspruch|deadline|remind|letter|notice|kalender|calendar/iu,
    tools: [
      "reminder.create",
      "reminder.list",
      "reminder.extract",
      "docs.explainLetter",
      "calendar.createEvent",
    ],
  },
  {
    pattern:
      /medikament|arznei|rezept|heilmittel|eko|erstatt|rückerstatt|kosten|gebühr|selbstbehalt|rechnung|honorar|wahlarzt|zuzahl|medicine|prescription|reimburs|fee|cost|invoice/iu,
    tools: ["eko.lookupCoverage", "fees.explainReimbursement"],
  },
  {
    pattern:
      /angehörig|angehoerig|helfer|teilen|freigeb|übergabe|uebergabe|zusammenfass|tochter|sohn|mutter|vater|helper|share|handoff|summary|relative/iu,
    tools: ["session.shareWithHelper", "handoff.compose"],
  },
];

/** Lookups and display tools: what a turn may use before the user confirms a case goal. */
const READ_ONLY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "kb.search",
  "catalog.findBenefits",
  "catalog.getBenefit",
  "office.resolve",
  "facility.search",
  "eko.lookupCoverage",
  "fees.explainReimbursement",
  "form.find",
  "context.queryFacts",
  "context.readScreen",
  "context.readPage",
  "ui.point",
  "ui.highlight",
  "ui.annotate",
  "ui.caption",
  "ui.offerResource",
  "ui.openResource",
]);
const OFFER_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "ui.offerResource",
  "ui.openResource",
]);

/**
 * Tools of topic groups the request does not touch. Everything else (knowledge, catalog, process,
 * case, screen and display tools, and any tool not in a group) stays offered, and so does every
 * tool already used in this conversation, so continuations and approvals keep working. Permission
 * filtering (autonomy, role) still applies; this only removes tool schemas from the model call.
 */
export function irrelevantToolNames(input: {
  texts: readonly string[];
  history: readonly LotseMessage[];
  /** No confirmed goal: only lookups and display tools, whatever the history used. */
  readOnly?: boolean;
  /** With readOnly, false also removes resource offers (the answer offers the goal instead). */
  offering?: boolean;
}): ReadonlySet<ToolName> {
  const text = input.texts.join("\n");
  const excluded = new Set<ToolName>();
  const kept = new Set<ToolName>();
  for (const group of GROUPS)
    for (const tool of group.tools) (group.pattern.test(text) ? kept : excluded).add(tool);
  for (const message of input.history)
    for (const part of message.parts)
      if (isToolUIPart(part)) kept.add(getToolName(part) as ToolName);
  for (const tool of kept) excluded.delete(tool);
  if (input.readOnly)
    for (const tool of toolNames)
      if (!READ_ONLY_TOOLS.has(tool) || (input.offering === false && OFFER_TOOLS.has(tool)))
        excluded.add(tool);
  return excluded;
}
