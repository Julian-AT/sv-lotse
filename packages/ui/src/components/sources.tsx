"use client";

import type { JSX } from "react";
import { useId } from "react";
import type { LabelProps } from "../copy/de";
import { de } from "../copy/de";
import { Card, Heading, Link, Stack, Text } from "./primitives";

/** Source data is supplied by the workspace, never retrieved or interpreted here. */
export interface Citation {
  id: string;
  title: string;
  quote: string;
  url: string;
  asOf: string;
  legalBasis?: string;
}
export function CitationChip({ source }: { source: Citation }): JSX.Element {
  return (
    <Link className="lotse-citation" href={source.url}>
      {source.title}
    </Link>
  );
}

export interface WhyPanelProps extends LabelProps {
  sources: readonly Citation[];
  confidence?: string;
  unknowns?: readonly string[];
}
export function WhyPanel({
  sources,
  confidence,
  unknowns = [],
  labels,
}: WhyPanelProps): JSX.Element {
  const id = useId();
  const copy = { ...de, ...labels };
  return (
    <section aria-labelledby={id} className="lotse-why-panel">
      <Heading id={id}>{copy.why}</Heading>
      <Stack>
        {sources.map((source) => (
          <Card key={source.id}>
            <CitationChip source={source} />
            <blockquote className="lotse-quote">{source.quote}</blockquote>
            <dl className="lotse-metadata">
              {source.asOf && (
                <>
                  <dt>{copy.asOf}</dt>
                  <dd>
                    <time dateTime={source.asOf}>{source.asOf}</time>
                  </dd>
                </>
              )}
              {source.legalBasis && (
                <>
                  <dt>{copy.legalBasis}</dt>
                  <dd>{source.legalBasis}</dd>
                </>
              )}
            </dl>
          </Card>
        ))}
        {confidence && (
          <div>
            <Heading level={3}>{copy.confidence}</Heading>
            <Text>{confidence}</Text>
          </div>
        )}
        {unknowns.length > 0 && (
          <div>
            <Heading level={3}>{copy.unknowns}</Heading>
            <ul>
              {[...new Set(unknowns)].map((unknown) => (
                <li key={unknown}>{unknown}</li>
              ))}
            </ul>
          </div>
        )}
      </Stack>
    </section>
  );
}
