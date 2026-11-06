// Result frame after Medlyn's gen-ui ToolFrame (owner's project): one card shape for every tool
// result with an icon tile, a kind label, the title, a body and an optional footer of actions.
"use client";

import type { Citation, Labels } from "@lotse/ui";
import { ChevronDownIcon, type LucideIcon } from "lucide-react";
import { type JSX, type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { safeHref } from "./source-chips";

export function ResultCard({
  icon: Icon,
  eyebrow,
  title,
  aside,
  children,
  footer,
  why,
  className,
}: {
  icon: LucideIcon;
  eyebrow?: string | undefined;
  title: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** "Warum?" opens the Why panel in place; the button name also states its subject. */
  why?: { label: string; subject: string; panel: () => ReactNode } | undefined;
  className?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <article
      className={cn(
        "fade-up w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <header className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-text"
        >
          <Icon className="size-4" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          {eyebrow && (
            <p className="m-0 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              {eyebrow}
            </p>
          )}
          <h3 className="m-0 text-[15px] font-semibold leading-snug tracking-tight break-words">
            {title}
          </h3>
        </div>
        {aside && <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{aside}</div>}
      </header>
      {children && <div className="grid min-w-0 gap-3 px-4 pb-4 text-[13px]">{children}</div>}
      {(footer || why) && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
          {footer}
          {why && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panel}
              aria-label={`${why.label} ${why.subject}`}
              onClick={() => setOpen((current) => !current)}
              className="ml-auto inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {why.label}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn("size-3.5 transition-transform", open && "rotate-180")}
              />
            </button>
          )}
        </footer>
      )}
      {why && (
        <div id={panel} hidden={!open} className="border-t border-border px-4 py-3">
          {open ? why.panel() : null}
        </div>
      )}
    </article>
  );
}

/** Why panel: each source with its verbatim quote, as-of date and legal basis, then confidence. */
export function WhyPanel({
  sources,
  confidence,
  unknowns = [],
  labels,
}: {
  sources: readonly Citation[];
  confidence?: string | undefined;
  unknowns?: readonly string[];
  labels: Labels;
}): JSX.Element {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-3 text-[13px]">
      <h4 id={id} className="m-0 text-xs font-semibold text-muted-foreground">
        {labels.why}
      </h4>
      <div className="grid gap-2">
        {sources.map((source) => {
          const href = safeHref(source.url);
          return (
            <div key={source.id} className="grid gap-1.5 rounded-xl bg-muted/50 px-3 py-2.5">
              <a
                href={href}
                {...(href && /^https?:/u.test(href)
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="w-fit text-xs font-medium text-brand-text underline-offset-2 hover:underline"
              >
                {source.title}
              </a>
              <blockquote className="m-0 border-l-2 border-brand/60 pl-3 leading-relaxed">
                {source.quote}
              </blockquote>
              <dl className="m-0 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                {source.asOf && (
                  <div className="flex gap-1">
                    <dt>{labels.asOf}</dt>
                    <dd className="m-0 tabular-nums">
                      <time dateTime={source.asOf}>{source.asOf}</time>
                    </dd>
                  </div>
                )}
                {source.legalBasis && (
                  <div className="flex gap-1">
                    <dt>{labels.legalBasis}</dt>
                    <dd className="m-0">{source.legalBasis}</dd>
                  </div>
                )}
              </dl>
            </div>
          );
        })}
      </div>
      {confidence && (
        <div className="grid gap-1">
          <h5 className="m-0 text-xs font-semibold">{labels.confidence}</h5>
          <p className="m-0 text-muted-foreground">{confidence}</p>
        </div>
      )}
      {unknowns.length > 0 && (
        <div className="grid gap-1">
          <h5 className="m-0 text-xs font-semibold">{labels.unknowns}</h5>
          <ul className="m-0 grid list-disc gap-0.5 pl-4 text-muted-foreground">
            {[...new Set(unknowns)].map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Label/value rows as a compact two-column table (EKO, fees). */
export function FactTable({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] overflow-hidden rounded-xl border border-border text-[13px]">
      {rows.map(([term, value], index) => (
        <div
          key={term}
          className={cn("contents", index > 0 && "[&>*]:border-t [&>*]:border-border")}
        >
          <dt className="bg-muted/40 px-3 py-2 text-muted-foreground">{term}</dt>
          <dd className="m-0 px-3 py-2 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
