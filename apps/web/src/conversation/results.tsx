"use client";

import type { LotseMessage } from "@lotse/brain";
import { workspaceTargets } from "@lotse/brain/workspace/targets";
import { type Citation, de, en, type Labels } from "@lotse/ui";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleHelpIcon,
  ExternalLinkIcon,
  FileCheck2Icon,
  HandCoinsIcon,
  LandmarkIcon,
  PillIcon,
  XCircleIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useId } from "react";
import { FactTable, ResultCard, WhyPanel } from "@/components/gen-ui/result-card.tsx";
import { SourceChips, safeHref } from "@/components/gen-ui/source-chips.tsx";
import { cn } from "@/lib/utils";
import { INTL_LOCALES } from "../i18n/config.ts";
import { WORKSPACE_CONFIG } from "./config.ts";
import { type ResultCopy, resultCopy } from "./result-copy.ts";
import { type ToolSource, toolCitations, uniqueCitations } from "./sources.ts";
import {
  type Benefit,
  type ChecklistItem,
  type Coverage,
  CRITERION_STATUSES,
  type Criterion,
  type CriterionStatus,
  criterionText,
  groupCriteria,
  type Reimbursement,
  type ToolResult,
  toolResults,
} from "./tool-results.ts";

type Language = "de" | "en";
interface Context {
  language: Language;
  copy: ResultCopy;
  labels: Labels;
  scope: { subjectId: string } | undefined;
}

// Eligibility states after Medlyn's claim lines: an icon and a colour per state, never colour alone.
const STATUS_STYLE: Readonly<
  Record<CriterionStatus, { icon: typeof CheckCircle2Icon; text: string; bar: string }>
> = {
  met: { icon: CheckCircle2Icon, text: "text-brand-text", bar: "bg-brand" },
  unknown: { icon: CircleHelpIcon, text: "text-caution", bar: "bg-caution" },
  not_met: { icon: XCircleIcon, text: "text-muted-foreground", bar: "bg-muted-foreground/40" },
};

function cite(
  sources: readonly ToolSource[],
  key: string,
  context: Context,
  legalBasis?: string,
): Citation[] {
  return toolCitations(sources, {
    key,
    documentTitle: context.copy.yourDocument,
    ...(legalBasis ? { legalBasis } : {}),
    ...(context.scope ? { scope: context.scope } : {}),
  });
}

function Chips({
  citations,
  context,
}: {
  citations: readonly Citation[];
  context: Context;
}): JSX.Element | null {
  return (
    <SourceChips citations={citations} label={context.labels.sources} labels={context.labels} />
  );
}

/** Segmented bar: share of met, open and unmet criteria (or documents). */
function Meter({
  parts,
  label,
}: {
  parts: readonly { key: string; count: number; className: string }[];
  label: string;
}): JSX.Element {
  const total = parts.reduce((sum, part) => sum + part.count, 0) || 1;
  return (
    <div className="grid gap-1.5">
      <div aria-hidden="true" className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
        {parts
          .filter((part) => part.count > 0)
          .map((part) => (
            <span
              key={part.key}
              className={cn("h-full rounded-full", part.className)}
              style={{ width: `${(part.count / total) * 100}%` }}
            />
          ))}
      </div>
      <p className="m-0 text-xs text-muted-foreground tabular-nums">{label}</p>
    </div>
  );
}

function CriterionGroup({
  status,
  criteria,
  prefix,
  context,
}: {
  status: CriterionStatus;
  criteria: readonly Criterion[];
  prefix: string;
  context: Context;
}): JSX.Element {
  const heading = useId();
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <section aria-labelledby={heading} className="grid gap-1.5" data-status={status}>
      <h4
        id={heading}
        className={cn("m-0 flex items-center gap-1.5 text-xs font-semibold", style.text)}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        <span>
          {context.copy.criteria[status]} ({criteria.length})
        </span>
      </h4>
      <ul className="m-0 grid list-none gap-2 p-0">
        {criteria.map((criterion) => (
          <li
            key={criterion.id}
            className="grid gap-1.5 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5"
          >
            <p className="m-0 leading-relaxed">{criterionText(criterion)}</p>
            {criterion.legalBasis && (
              <p className="m-0 text-[11px] text-muted-foreground">
                {context.labels.legalBasis}: {criterion.legalBasis}
              </p>
            )}
            <Chips
              citations={cite(criterion.sources, `${prefix}:${criterion.id}`, context)}
              context={context}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BenefitCard({
  benefit,
  callId,
  context,
}: {
  benefit: Benefit;
  callId: string;
  context: Context;
}): JSX.Element {
  const prefix = `${callId}:${benefit.id}`;
  const groups = groupCriteria(benefit.criteria);
  const citations = uniqueCitations([
    ...cite(benefit.sources, prefix, context),
    ...benefit.criteria.flatMap((criterion) =>
      cite(criterion.sources, `${prefix}:${criterion.id}:why`, context, criterion.legalBasis),
    ),
  ]);
  return (
    <ResultCard
      icon={LandmarkIcon}
      eyebrow={context.copy.benefits}
      title={benefit.title}
      aside={
        benefit.scope && (
          <span className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[11px] font-medium text-muted-foreground">
            {context.copy.scopes[benefit.scope]}
          </span>
        )
      }
      footer={<Chips citations={cite(benefit.sources, prefix, context)} context={context} />}
      why={{
        label: context.copy.why,
        subject: benefit.title,
        panel: () => (
          <WhyPanel
            sources={citations}
            confidence={context.copy.confidence({
              met: groups.met.length,
              unknown: groups.unknown.length,
              notMet: groups.not_met.length,
            })}
            unknowns={groups.unknown.map(criterionText)}
            labels={context.labels}
          />
        ),
      }}
    >
      {benefit.criteria.length > 0 && (
        <Meter
          label={context.copy.criteriaSummary(groups.met.length, benefit.criteria.length)}
          parts={CRITERION_STATUSES.map((status) => ({
            key: status,
            count: groups[status].length,
            className: STATUS_STYLE[status].bar,
          }))}
        />
      )}
      {CRITERION_STATUSES.filter((status) => groups[status].length > 0).map((status) => (
        <CriterionGroup
          key={status}
          status={status}
          criteria={groups[status]}
          prefix={prefix}
          context={context}
        />
      ))}
    </ResultCard>
  );
}

function BenefitResults({
  benefits,
  callId,
  context,
}: {
  benefits: readonly Benefit[];
  callId: string;
  context: Context;
}): JSX.Element {
  return (
    <section aria-label={context.copy.benefits} className="grid gap-3">
      <p className="m-0 text-xs text-muted-foreground">{context.copy.criteriaHint}</p>
      {benefits.map((benefit) => (
        <BenefitCard key={benefit.id} benefit={benefit} callId={callId} context={context} />
      ))}
    </section>
  );
}

const DOCUMENT_STYLE = {
  have: { icon: CheckCircle2Icon, text: "text-brand-text", bar: "bg-brand" },
  obtainable: { icon: CircleDashedIcon, text: "text-caution", bar: "bg-caution" },
  missing: { icon: XCircleIcon, text: "text-destructive", bar: "bg-destructive/70" },
} as const;

function ChecklistCard({
  items,
  callId,
  context,
}: {
  items: readonly ChecklistItem[];
  callId: string;
  context: Context;
}): JSX.Element {
  const entries = items.map((item) => ({
    item,
    citations: cite(item.sources, `${callId}:${item.type}`, context),
  }));
  const count = (status: ChecklistItem["status"]) =>
    items.filter((item) => item.status === status).length;
  return (
    <ResultCard
      icon={FileCheck2Icon}
      eyebrow={context.copy.checklist}
      title={context.copy.documentsSummary(count("have"), items.length)}
      why={{
        label: context.copy.why,
        subject: context.copy.checklist,
        panel: () => (
          <WhyPanel
            sources={uniqueCitations(entries.flatMap((entry) => entry.citations))}
            labels={context.labels}
          />
        ),
      }}
    >
      <Meter
        label={`${context.copy.documentStatus.missing}: ${count("missing")} · ${context.copy.documentStatus.obtainable}: ${count("obtainable")}`}
        parts={(["have", "obtainable", "missing"] as const).map((status) => ({
          key: status,
          count: count(status),
          className: DOCUMENT_STYLE[status].bar,
        }))}
      />
      <ul className="m-0 grid list-none gap-0 divide-y divide-border p-0">
        {entries.map(({ item, citations }) => {
          const style = DOCUMENT_STYLE[item.status];
          const Icon = style.icon;
          return (
            <li key={item.type} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
              <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", style.text)} />
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <strong className="font-medium">{item.title ?? item.type}</strong>
                  <span className={cn("text-[11px] font-medium", style.text)}>
                    {context.copy.documentStatus[item.status]}
                  </span>
                </div>
                {item.whereToObtain && item.status !== "have" && (
                  <p className="m-0 text-xs text-muted-foreground">
                    {context.copy.whereToObtain}: <span>{item.whereToObtain}</span>
                  </p>
                )}
                {citations[0] && <Chips citations={[citations[0]]} context={context} />}
              </div>
            </li>
          );
        })}
      </ul>
    </ResultCard>
  );
}

const BOX_DOT: Readonly<Record<NonNullable<Coverage["box"]>, string>> = {
  green: "bg-[#008e5c]",
  yellow_re1: "bg-[#e0a800]",
  yellow_re2: "bg-[#e0a800]",
  red: "bg-[#d64545]",
};

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full border border-border bg-background px-2 text-[11px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function CoverageCard({
  coverage,
  medicine,
  callId,
  context,
}: {
  coverage: Coverage;
  medicine: string | undefined;
  callId: string;
  context: Context;
}): JSX.Element {
  const { copy } = context;
  const citations = cite(coverage.sources, callId, context);
  const approval = coverage.approvalRequired
    ? `${copy.approvalRequired}${coverage.approvalRequestedBy ? ` (${copy.approvalRequestedBy}: ${coverage.approvalRequestedBy})` : ""}`
    : copy.approvalNotRequired;
  const rows: [string, string][] = [[copy.approvalRequired, approval]];
  if (coverage.prescriptionFee) rows.push([copy.prescriptionFee, coverage.prescriptionFee]);
  if (coverage.capRule) rows.push([copy.capRule, coverage.capRule]);
  if (coverage.exemptionRule) rows.push([copy.exemptionRule, coverage.exemptionRule]);
  return (
    <ResultCard
      icon={PillIcon}
      eyebrow={copy.coverage}
      title={medicine ?? copy.coverage}
      footer={<Chips citations={citations} context={context} />}
      why={{
        label: copy.why,
        subject: medicine ?? copy.coverage,
        panel: () => <WhyPanel sources={uniqueCitations(citations)} labels={context.labels} />,
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        <Pill className={coverage.listed ? "text-brand-text" : "text-caution"}>
          {coverage.listed ? (
            <CheckCircle2Icon aria-hidden="true" className="size-3" />
          ) : (
            <CircleHelpIcon aria-hidden="true" className="size-3" />
          )}
          <span>{coverage.listed ? copy.listed : copy.notListed}</span>
        </Pill>
        {coverage.box && (
          <Pill>
            <span aria-hidden="true" className={cn("size-2 rounded-full", BOX_DOT[coverage.box])} />
            <span>{copy.boxes[coverage.box]}</span>
          </Pill>
        )}
      </div>
      <FactTable rows={rows} />
      {coverage.conditionsFlag && <p className="m-0 text-muted-foreground">{copy.conditions}</p>}
    </ResultCard>
  );
}

function ReimbursementCard({
  reimbursement,
  service,
  callId,
  context,
}: {
  reimbursement: Reimbursement;
  service: string | undefined;
  callId: string;
  context: Context;
}): JSX.Element {
  const { copy } = context;
  const citations = cite(reimbursement.sources, callId, context);
  const amount =
    reimbursement.illustrativeAmount === null
      ? undefined
      : new Intl.NumberFormat(INTL_LOCALES[context.language], {
          style: "currency",
          currency: WORKSPACE_CONFIG.reimbursementCurrency,
        }).format(reimbursement.illustrativeAmount);
  const online = reimbursement.channels.onlineUrl
    ? safeHref(reimbursement.channels.onlineUrl)
    : undefined;
  return (
    <ResultCard
      icon={HandCoinsIcon}
      eyebrow={copy.reimbursement}
      title={service ?? copy.reimbursement}
      footer={
        <>
          {online && (
            <a
              href={online}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground! transition-colors hover:bg-primary/90"
            >
              {copy.submitOnline}
              <ExternalLinkIcon aria-hidden="true" className="size-3" />
            </a>
          )}
          <Chips citations={citations} context={context} />
        </>
      }
      why={{
        label: copy.why,
        subject: service ?? copy.reimbursement,
        panel: () => (
          <WhyPanel
            sources={uniqueCitations(citations)}
            confidence={copy.illustrative}
            labels={context.labels}
          />
        ),
      }}
    >
      {amount && (
        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
          <span className="text-xs text-muted-foreground">{copy.illustrativeAmount}</span>
          <span className="text-xl font-semibold tracking-tight tabular-nums">{amount}</span>
        </div>
      )}
      <p className="m-0 leading-relaxed">{reimbursement.ruleText}</p>
      <FactTable
        rows={[
          [
            copy.asOf,
            <time key="asOf" dateTime={reimbursement.asOf}>
              {reimbursement.asOf}
            </time>,
          ],
        ]}
      />
      <p className="m-0 text-xs text-muted-foreground">{copy.illustrative}</p>
      {reimbursement.requiredDocuments.length > 0 && (
        <div className="grid gap-1.5">
          <h4 className="m-0 text-xs font-semibold">{copy.requiredDocuments}</h4>
          <ul className="m-0 grid list-none gap-1 p-0">
            {reimbursement.requiredDocuments.map((document) => (
              <li key={document} className="flex items-center gap-2">
                <FileCheck2Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                <span>{document}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ResultCard>
  );
}

function ResultView({ result, context }: { result: ToolResult; context: Context }): JSX.Element {
  switch (result.kind) {
    case "benefits":
      return <BenefitResults benefits={result.benefits} callId={result.callId} context={context} />;
    case "checklist":
      return <ChecklistCard items={result.items} callId={result.callId} context={context} />;
    case "coverage":
      return (
        <CoverageCard
          coverage={result.coverage}
          medicine={result.medicine}
          callId={result.callId}
          context={context}
        />
      );
    case "reimbursement":
      return (
        <ReimbursementCard
          reimbursement={result.reimbursement}
          service={result.service}
          callId={result.callId}
          context={context}
        />
      );
  }
}

/** Render sourced brain results as cards, independently of the generated conversational prose. */
export function ToolResultCards({
  message,
  language,
  subjectId,
  labels,
  callId,
}: {
  message: LotseMessage;
  language: Language;
  subjectId?: string;
  labels?: Partial<Labels>;
  /** Only the result of this tool call (cards render inline at their tool part). */
  callId?: string;
}): JSX.Element | null {
  const results = toolResults(message).filter((result) => !callId || result.callId === callId);
  if (!results.length) return null;
  const context: Context = {
    language,
    copy: resultCopy[language],
    labels: { ...de, ...(language === "en" ? en : {}), ...labels },
    scope: subjectId ? { subjectId } : undefined,
  };
  return (
    <>
      {results.map((result) => (
        <div key={result.callId} id={workspaceTargets.resultCard(result.callId)}>
          <ResultView result={result} context={context} />
        </div>
      ))}
    </>
  );
}
