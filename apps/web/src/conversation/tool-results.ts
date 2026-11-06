import type { LotseMessage } from "@lotse/brain";
import { getToolName, isToolUIPart } from "ai";
import { z } from "zod";

// Display boundary for sourced brain results. Unsafe or unsourced output is withheld, never repaired.
const text = z.string().min(1);
const httpUrl = z.url({ protocol: /^https?$/u });
const source = z.object({
  url: z.url({ protocol: /^(?:https?|document)$/u }),
  quote: z.string(),
  asOf: z.iso.date(),
});
const sources = z.array(source);
export const CRITERION_STATUSES = ["met", "unknown", "not_met"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];
const criterionSchema = z.object({
  id: text,
  status: z.enum(CRITERION_STATUSES),
  sources: sources.min(1),
  text: text.optional(),
  legalBasis: text.optional(),
});
const benefitSchema = z.object({
  id: text,
  title: text,
  criteria: z.array(criterionSchema),
  sources,
  scope: z.enum(["social_insurance", "federal", "state", "municipality", "other"]).optional(),
});
const checklistSchema = z.array(
  z.object({
    type: text,
    title: text.optional(),
    status: z.enum(["have", "missing", "obtainable"]),
    whereToObtain: z.string(),
    sources: sources.min(1),
  }),
);
const coverageSchema = z.object({
  listed: z.boolean(),
  box: z.enum(["green", "yellow_re1", "yellow_re2", "red"]).nullable(),
  approvalRequired: z.boolean(),
  approvalRequestedBy: z.string().nullable(),
  conditionsFlag: z.boolean(),
  prescriptionFee: z.string(),
  capRule: z.string(),
  exemptionRule: z.string(),
  sources: sources.min(1),
});
const reimbursementSchema = z.object({
  ruleText: text,
  requiredDocuments: z.array(text),
  channels: z.object({ onlineUrl: httpUrl.optional() }),
  illustrativeAmount: z.number().nonnegative().nullable(),
  asOf: z.iso.date(),
  illustrative: z.literal(true),
  sources: sources.min(1),
});
const medicineInput = z.object({ medicineNameExact: text });
const serviceInput = z.object({ serviceDescription: text });

export type Criterion = z.infer<typeof criterionSchema>;
export type Benefit = z.infer<typeof benefitSchema>;
export type ChecklistItem = z.infer<typeof checklistSchema>[number];
export type Coverage = z.infer<typeof coverageSchema>;
export type Reimbursement = z.infer<typeof reimbursementSchema>;
export type ToolResult =
  | { kind: "benefits"; callId: string; benefits: Benefit[] }
  | { kind: "checklist"; callId: string; items: ChecklistItem[] }
  | { kind: "coverage"; callId: string; medicine?: string; coverage: Coverage }
  | { kind: "reimbursement"; callId: string; service?: string; reimbursement: Reimbursement };

type ToolPart = { toolCallId: string; input: unknown; output: unknown };
type Reader = (part: ToolPart) => ToolResult | undefined;

function benefitsResult(part: ToolPart): ToolResult | undefined {
  // Items are validated one by one so a single malformed candidate cannot hide the others.
  const items = z.array(z.unknown()).safeParse(part.output);
  if (!items.success) return undefined;
  const benefits = items.data.flatMap((item) => {
    const parsed = benefitSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return benefits.length ? { kind: "benefits", callId: part.toolCallId, benefits } : undefined;
}

const readers: Readonly<Record<string, Reader>> = {
  "catalog.findBenefits": benefitsResult,
  "documents.checklist": (part) => {
    const items = checklistSchema.safeParse(part.output);
    return items.success && items.data.length
      ? { kind: "checklist", callId: part.toolCallId, items: items.data }
      : undefined;
  },
  "eko.lookupCoverage": (part) => {
    const coverage = coverageSchema.safeParse(part.output);
    const input = medicineInput.safeParse(part.input);
    return coverage.success
      ? {
          kind: "coverage",
          callId: part.toolCallId,
          coverage: coverage.data,
          ...(input.success ? { medicine: input.data.medicineNameExact } : {}),
        }
      : undefined;
  },
  "fees.explainReimbursement": (part) => {
    const reimbursement = reimbursementSchema.safeParse(part.output);
    const input = serviceInput.safeParse(part.input);
    return reimbursement.success
      ? {
          kind: "reimbursement",
          callId: part.toolCallId,
          reimbursement: reimbursement.data,
          ...(input.success ? { service: input.data.serviceDescription } : {}),
        }
      : undefined;
  },
};

/** Sourced results of completed catalog, document, coverage and fee tools, in stream order. */
export function toolResults(message: LotseMessage): ToolResult[] {
  if (message.role !== "assistant") return [];
  return message.parts.flatMap((part) => {
    if (!isToolUIPart(part) || part.state !== "output-available") return [];
    const result = readers[getToolName(part)]?.(part);
    return result ? [result] : [];
  });
}

export function groupCriteria(
  criteria: readonly Criterion[],
): Record<CriterionStatus, Criterion[]> {
  return {
    met: criteria.filter((criterion) => criterion.status === "met"),
    unknown: criteria.filter((criterion) => criterion.status === "unknown"),
    not_met: criteria.filter((criterion) => criterion.status === "not_met"),
  };
}

/** Criterion wording from the catalog; older results without it fall back to the source quote. */
export function criterionText(criterion: Criterion): string {
  return criterion.text ?? criterion.sources.find((entry) => entry.quote)?.quote ?? criterion.id;
}
