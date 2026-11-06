"use client";

import type { LotseMessage } from "@lotse/brain";
import { workspaceTargets } from "@lotse/brain/workspace/targets";
import {
  Badge,
  Button,
  Card,
  type Citation,
  CitationChip,
  DocumentChecklist,
  de,
  en,
  Heading,
  type Labels,
  Link,
  Text,
  type Tone,
  WhyPanel,
} from "@lotse/ui";
import { type JSX, type ReactNode, useId, useState } from "react";
import { INTL_LOCALES } from "../i18n/config.ts";
import { WORKSPACE_CONFIG } from "./config.ts";
import { type ResultCopy, resultCopy } from "./result-copy.ts";
import styles from "./results.module.css";
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
const STATUS_TONES: Readonly<Record<CriterionStatus, Tone>> = {
  met: "success",
  unknown: "warning",
  not_met: "error",
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

function SourceChips({
  citations,
  context,
}: {
  citations: readonly Citation[];
  context: Context;
}): JSX.Element | null {
  if (!citations.length) return null;
  return (
    <ul className={styles.chips} aria-label={context.labels.sources}>
      {citations.map((citation) => (
        <li key={citation.id}>
          <CitationChip source={citation} />
        </li>
      ))}
    </ul>
  );
}

/** "Warum?" opens the recommendation's Why panel in place; the name also states its subject. */
function WhyToggle({
  subject,
  context,
  children,
}: {
  subject: string;
  context: Context;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className={styles.why}>
      <Button
        variant="secondary"
        aria-expanded={open}
        aria-controls={panel}
        aria-label={`${context.copy.why} ${subject}`}
        onClick={() => setOpen((current) => !current)}
      >
        {context.copy.why}
      </Button>
      <div id={panel} hidden={!open}>
        {open ? children : null}
      </div>
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
  return (
    <section aria-labelledby={heading} className={styles.group} data-status={status}>
      <Heading level={4} id={heading} className={styles.groupHeading}>
        <Badge tone={STATUS_TONES[status]}>{context.copy.criteria[status]}</Badge> (
        {criteria.length})
      </Heading>
      <ul className={styles.criteria}>
        {criteria.map((criterion) => (
          <li key={criterion.id}>
            <Text>{criterionText(criterion)}</Text>
            {criterion.legalBasis && (
              <Text tone="muted" className={styles.legal}>
                {context.labels.legalBasis}: {criterion.legalBasis}
              </Text>
            )}
            <SourceChips
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
    <Card variant="glass" className={styles.card}>
      <div className={styles.header}>
        <Heading level={3}>{benefit.title}</Heading>
        {benefit.scope && <Badge tone="info">{context.copy.scopes[benefit.scope]}</Badge>}
      </div>
      <div className={styles.groups}>
        {CRITERION_STATUSES.filter((status) => groups[status].length > 0).map((status) => (
          <CriterionGroup
            key={status}
            status={status}
            criteria={groups[status]}
            prefix={prefix}
            context={context}
          />
        ))}
      </div>
      <WhyToggle subject={benefit.title} context={context}>
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
      </WhyToggle>
    </Card>
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
    <section aria-label={context.copy.benefits} className={styles.results}>
      <Text tone="muted">{context.copy.criteriaHint}</Text>
      {benefits.map((benefit) => (
        <BenefitCard key={benefit.id} benefit={benefit} callId={callId} context={context} />
      ))}
    </section>
  );
}

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
  return (
    <Card variant="glass" className={styles.card}>
      <DocumentChecklist
        labels={context.labels}
        items={entries.map(({ item, citations }) => ({
          id: item.type,
          title: item.title ?? item.type,
          status: item.status,
          ...(item.whereToObtain ? { where: item.whereToObtain } : {}),
          ...(citations[0] ? { source: citations[0] } : {}),
        }))}
      />
      <WhyToggle subject={context.copy.checklist} context={context}>
        <WhyPanel
          sources={uniqueCitations(entries.flatMap((entry) => entry.citations))}
          labels={context.labels}
        />
      </WhyToggle>
    </Card>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
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
  return (
    <Card variant="glass" className={styles.card}>
      <Heading level={3}>{medicine ?? copy.coverage}</Heading>
      {medicine && <Text tone="muted">{copy.coverage}</Text>}
      <div className={styles.badges}>
        <Badge tone={coverage.listed ? "success" : "warning"}>
          {coverage.listed ? copy.listed : copy.notListed}
        </Badge>
        {coverage.box && <Badge tone="info">{copy.boxes[coverage.box]}</Badge>}
      </div>
      <dl className="lotse-metadata">
        <Detail term={copy.approvalRequired}>{approval}</Detail>
        {coverage.prescriptionFee && (
          <Detail term={copy.prescriptionFee}>{coverage.prescriptionFee}</Detail>
        )}
        {coverage.capRule && <Detail term={copy.capRule}>{coverage.capRule}</Detail>}
        {coverage.exemptionRule && (
          <Detail term={copy.exemptionRule}>{coverage.exemptionRule}</Detail>
        )}
      </dl>
      {coverage.conditionsFlag && <Text>{copy.conditions}</Text>}
      <SourceChips citations={citations} context={context} />
      <WhyToggle subject={medicine ?? copy.coverage} context={context}>
        <WhyPanel sources={uniqueCitations(citations)} labels={context.labels} />
      </WhyToggle>
    </Card>
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
  return (
    <Card variant="glass" className={styles.card}>
      <Heading level={3}>{service ?? copy.reimbursement}</Heading>
      {service && <Text tone="muted">{copy.reimbursement}</Text>}
      <Text>{reimbursement.ruleText}</Text>
      <dl className="lotse-metadata">
        {amount && <Detail term={copy.illustrativeAmount}>{amount}</Detail>}
        <Detail term={copy.asOf}>
          <time dateTime={reimbursement.asOf}>{reimbursement.asOf}</time>
        </Detail>
      </dl>
      <Text tone="muted">{copy.illustrative}</Text>
      {reimbursement.requiredDocuments.length > 0 && (
        <>
          <Heading level={4}>{copy.requiredDocuments}</Heading>
          <ul>
            {reimbursement.requiredDocuments.map((document) => (
              <li key={document}>{document}</li>
            ))}
          </ul>
        </>
      )}
      {reimbursement.channels.onlineUrl && (
        <Link href={reimbursement.channels.onlineUrl}>{copy.submitOnline}</Link>
      )}
      <SourceChips citations={citations} context={context} />
      <WhyToggle subject={service ?? copy.reimbursement} context={context}>
        <WhyPanel
          sources={uniqueCitations(citations)}
          confidence={copy.illustrative}
          labels={context.labels}
        />
      </WhyToggle>
    </Card>
  );
}

function ResultCard({ result, context }: { result: ToolResult; context: Context }): JSX.Element {
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
}: {
  message: LotseMessage;
  language: Language;
  subjectId?: string;
  labels?: Partial<Labels>;
}): JSX.Element | null {
  const results = toolResults(message);
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
          <ResultCard result={result} context={context} />
        </div>
      ))}
    </>
  );
}
