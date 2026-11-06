"use client";

import type { JSX } from "react";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import { Text } from "./primitives";
import type { Citation } from "./sources";
import { CitationChip } from "./sources";

export interface ConversationBubbleProps extends LabelProps {
  speaker: "user" | "assistant";
  text: string;
  streaming?: boolean;
  citations?: readonly Citation[];
}
export function ConversationBubble({
  speaker,
  text,
  streaming = false,
  citations = [],
  labels,
}: ConversationBubbleProps): JSX.Element {
  const copy = { ...de, ...labels };
  return (
    <article
      className="lotse-bubble"
      data-speaker={speaker}
      aria-label={copy[speaker]}
      data-streaming={streaming || undefined}
    >
      <strong>{copy[speaker]}</strong>
      <div
        aria-live={speaker === "assistant" ? "polite" : "off"}
        aria-atomic="false"
        aria-relevant="additions text"
      >
        <Text className="lotse-streaming-text">{text}</Text>
      </div>
      {citations.length > 0 && (
        <ul className="lotse-source-list" aria-label={copy.sources}>
          {citations.map((source) => (
            <li key={source.id}>
              <CitationChip source={source} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
