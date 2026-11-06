"use client";

import type { JSX, ReactNode } from "react";
import { useId } from "react";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import { Badge, Heading, Text } from "./primitives";
import type { Citation } from "./sources";
import { CitationChip } from "./sources";

export interface JourneyStep {
  id: string;
  title: string;
  status: "pending" | "current" | "completed" | "prepared";
  owner: "user" | "pilot" | "office";
  dueDate?: string;
}
export function JourneyMap({
  steps,
  labels,
  renderStepDetails,
}: LabelProps & {
  steps: readonly JourneyStep[];
  renderStepDetails?: (step: JourneyStep) => ReactNode;
}): JSX.Element {
  const id = useId();
  const copy = { ...de, ...labels };
  return (
    <section aria-labelledby={id}>
      <Heading id={id}>{copy.journey}</Heading>
      <ol className="lotse-journey" aria-label={copy.journey}>
        {steps.map((step) => (
          <li
            key={step.id}
            aria-current={step.status === "current" ? "step" : undefined}
            data-status={step.status}
          >
            <Heading level={3}>{step.title}</Heading>
            <Badge tone={step.status === "completed" ? "success" : "info"}>
              {copy[step.status]}
            </Badge>
            <dl className="lotse-metadata">
              <dt>{copy.owner}</dt>
              <dd>{copy[step.owner]}</dd>
              {step.dueDate && (
                <>
                  <dt>{copy.due}</dt>
                  <dd>
                    <time dateTime={step.dueDate}>{step.dueDate}</time>
                  </dd>
                </>
              )}
            </dl>
            {renderStepDetails?.(step)}
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface ChecklistItem {
  id: string;
  title: string;
  status: "have" | "missing" | "obtainable";
  where?: string;
  source?: Citation;
}
export function DocumentChecklist({
  items,
  labels,
}: LabelProps & { items: readonly ChecklistItem[] }): JSX.Element {
  const id = useId();
  const copy = { ...de, ...labels };
  return (
    <section aria-labelledby={id}>
      <Heading id={id}>{copy.documents}</Heading>
      <ul className="lotse-checklist">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>{" "}
            <Badge tone={item.status === "have" ? "success" : "warning"}>{copy[item.status]}</Badge>
            {item.where && (
              <>
                <Text tone="muted">{copy.where}</Text>
                <Text>{item.where}</Text>
              </>
            )}
            {item.source && <CitationChip source={item.source} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
