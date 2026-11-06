"use client";

import type { JSX } from "react";
import { useId } from "react";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import type { FactState } from "./decisions";
import { Badge, Heading, Link, Text } from "./primitives";
import type { Citation } from "./sources";
import { CitationChip } from "./sources";

export interface SafetyContact {
  label: string;
  number: string;
}
export interface SafetyNoticeProps {
  title: string;
  text: string;
  contacts: readonly SafetyContact[];
}
/** Display only fixed, reviewed content supplied by the safety guard. Never generate advice here. */
export function SafetyNotice({ title, text, contacts }: SafetyNoticeProps): JSX.Element {
  const id = useId();
  return (
    <section
      className="lotse-alert lotse-safety"
      data-tone="error"
      role="alert"
      aria-labelledby={id}
    >
      <Heading id={id}>{title}</Heading>
      <Text>{text}</Text>
      <ul className="lotse-contact-list">
        {contacts.map((contact) => (
          <li key={contact.number}>
            <Link href={`tel:${contact.number}`}>
              <strong>
                {contact.label} {contact.number}
              </strong>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface FormFieldOverlayProps extends LabelProps {
  label: string;
  value: string;
  state: FactState;
  source: Citation;
  /** Fractions of the containing page's width/height, measured from its top-left corner. */
  bounds: { x: number; y: number; width: number; height: number };
}
export function FormFieldOverlay({
  label,
  value,
  state,
  source,
  bounds,
  labels,
}: FormFieldOverlayProps): JSX.Element {
  const copy = { ...de, ...labels };
  return (
    <fieldset
      className="lotse-overlay"
      data-state={state}
      style={{
        left: `${bounds.x * 100}%`,
        top: `${bounds.y * 100}%`,
        width: `${bounds.width * 100}%`,
        height: `${bounds.height * 100}%`,
      }}
    >
      <legend>{label}</legend>
      <Text>{value}</Text>
      <Badge tone={state === "confirmed" ? "success" : "warning"}>{copy[state]}</Badge>
      <CitationChip source={source} />
    </fieldset>
  );
}
