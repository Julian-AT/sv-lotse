// Source chip concept from Medlyn's gen-ui (owner's project): a compact pill per source with the
// quote on hover; the link itself stays the accessible element.
"use client";

import type { Citation } from "@lotse/ui";
import { FileTextIcon, GlobeIcon } from "lucide-react";
import type { JSX } from "react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

const SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Keep caller-supplied links inert when their scheme could execute script. */
export function safeHref(href: string): string | undefined {
  const value = href.trim();
  if (/^(?:#|\/(?!\/)|\.\.?\/)/u.test(value)) return value;
  try {
    const url = new URL(value);
    return SCHEMES.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function external(href: string | undefined): boolean {
  return Boolean(href && /^https?:/u.test(href));
}

export function SourceChip({
  source,
  labels,
  className,
}: {
  source: Citation;
  labels: { asOf: string; legalBasis: string };
  className?: string;
}): JSX.Element {
  const href = safeHref(source.url);
  const Icon = href?.startsWith("/") ? FileTextIcon : GlobeIcon;
  return (
    <HoverCard openDelay={250} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Badge
          asChild
          variant="outline"
          className={cn("h-6 max-w-[15rem] gap-1 font-normal text-muted-foreground", className)}
        >
          <a
            href={href}
            {...(external(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            <Icon className="shrink-0" aria-hidden="true" />
            <span className="truncate">{source.title}</span>
          </a>
        </Badge>
      </HoverCardTrigger>
      {source.quote ? (
        <HoverCardContent className="chatbot-root w-80 max-w-[calc(100vw-2rem)] p-4" align="start">
          <p className="m-0 text-xs font-medium text-foreground">{source.title}</p>
          <blockquote className="mt-2 border-l-2 border-border pl-3 text-[0.8125rem] leading-relaxed text-foreground/90">
            {source.quote}
          </blockquote>
          {(source.asOf || source.legalBasis) && (
            <p className="mt-2 text-[0.6875rem] text-muted-foreground">
              {source.asOf && (
                <>
                  {labels.asOf} <time dateTime={source.asOf}>{source.asOf}</time>
                </>
              )}
              {source.asOf && source.legalBasis ? " · " : ""}
              {source.legalBasis && `${labels.legalBasis}: ${source.legalBasis}`}
            </p>
          )}
        </HoverCardContent>
      ) : null}
    </HoverCard>
  );
}

export function SourceChips({
  citations,
  label,
  labels,
  className,
}: {
  citations: readonly Citation[];
  label: string;
  labels: { asOf: string; legalBasis: string };
  className?: string;
}): JSX.Element | null {
  if (!citations.length) return null;
  return (
    <ul aria-label={label} className={cn("m-0 flex list-none flex-wrap gap-1.5 p-0", className)}>
      {citations.map((citation) => (
        <li key={citation.id}>
          <SourceChip source={citation} labels={labels} />
        </li>
      ))}
    </ul>
  );
}
