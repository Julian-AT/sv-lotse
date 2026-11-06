"use client";

import type { JSX } from "react";
import { useId } from "react";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import type { MaterialVariant } from "../tokens/index";
import { Badge, Button, Heading, Inline, Text } from "./primitives";
import type { Citation } from "./sources";
import { CitationChip } from "./sources";

export interface ApprovalCardProps extends LabelProps {
  variant?: MaterialVariant;
  title: string;
  changes: readonly string[];
  provenance: readonly Citation[];
  onApprove: () => void;
  onDecline: () => void;
  pending?: boolean;
}
/** Emits a decision only: persistence, voice recognition and authorization belong to callers. */
export function ApprovalCard({
  title,
  changes,
  provenance,
  onApprove,
  onDecline,
  pending = false,
  labels,
  variant = "glass",
}: ApprovalCardProps): JSX.Element {
  const id = useId();
  const copy = { ...de, ...labels };
  return (
    <section
      className="lotse-card lotse-decision"
      data-material={variant}
      aria-labelledby={`${id}-title`}
      aria-busy={pending || undefined}
    >
      <Heading id={`${id}-title`}>{title}</Heading>
      <ul>
        {[...new Set(changes)].map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
      <ul aria-label={copy.sources} className="lotse-source-list">
        {provenance.map((source) => (
          <li key={source.id}>
            <CitationChip source={source} />
            <blockquote className="lotse-quote">{source.quote}</blockquote>
          </li>
        ))}
      </ul>
      <Inline>
        <Button
          disabled={pending}
          onClick={onApprove}
          aria-describedby={`${id}-keyboard ${id}-voice`}
        >
          {copy.approve}
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={onDecline}
          aria-describedby={`${id}-keyboard ${id}-voice`}
        >
          {copy.decline}
        </Button>
      </Inline>
      <Text id={`${id}-keyboard`} tone="muted">
        {copy.keyboardHint}
      </Text>
      <Text id={`${id}-voice`} tone="muted">
        {copy.voiceHint}
      </Text>
    </section>
  );
}

export type FactState = "draft" | "confirmed";
export interface FactCardProps extends LabelProps {
  label: string;
  value: string;
  source: Citation;
  state: FactState;
  pending?: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onReject: () => void;
}
export function FactCard({
  label,
  value,
  source,
  state,
  pending = false,
  onConfirm,
  onEdit,
  onReject,
  labels,
}: FactCardProps): JSX.Element {
  const id = useId();
  const copy = { ...de, ...labels };
  return (
    <section
      className="lotse-card lotse-decision"
      aria-labelledby={id}
      aria-busy={pending || undefined}
    >
      <Heading id={id}>{label}</Heading>
      <Badge tone={state === "confirmed" ? "success" : "warning"}>{copy[state]}</Badge>
      <Text>{value}</Text>
      <CitationChip source={source} />
      <blockquote className="lotse-quote">{source.quote}</blockquote>
      <Inline>
        {state === "draft" && (
          <Button disabled={pending} onClick={onConfirm}>
            {copy.confirm}
          </Button>
        )}
        <Button variant="secondary" disabled={pending} onClick={onEdit}>
          {copy.edit}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onReject}>
          {copy.reject}
        </Button>
      </Inline>
    </section>
  );
}
