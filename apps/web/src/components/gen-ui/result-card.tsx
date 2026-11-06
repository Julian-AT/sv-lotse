// Result frame after Medlyn's gen-ui ToolFrame (owner's project): one card shape for every tool
// result with an icon tile, a kind label, the title, a body and an optional footer of actions.
"use client";

import type { Citation, Labels } from "@lotse/ui";
import { ChevronDownIcon, type LucideIcon } from "lucide-react";
import { type JSX, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
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
    <Card
      className={cn("fade-up w-full min-w-0 gap-3 pb-0", !(footer || why) && "pb-4", className)}
    >
      <CardHeader className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-foreground"
        >
          <Icon className="size-4" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          {eyebrow && (
            <CardDescription className="text-[11px] font-medium">{eyebrow}</CardDescription>
          )}
          <CardTitle className="break-words" role="heading" aria-level={3}>
            {title}
          </CardTitle>
        </div>
        {aside && <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{aside}</div>}
      </CardHeader>
      {children && <CardContent className="grid min-w-0 gap-3 text-[13px]">{children}</CardContent>}
      {(footer || why) && (
        <CardFooter className="mt-1 flex-wrap gap-2 border-t border-border py-2.5">
          {footer}
          {why && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={open}
              aria-controls={panel}
              aria-label={`${why.label} ${why.subject}`}
              onClick={() => setOpen((current) => !current)}
              className="ml-auto rounded-full text-muted-foreground"
            >
              {why.label}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn("transition-transform", open && "rotate-180")}
              />
            </Button>
          )}
        </CardFooter>
      )}
      {why && (
        <div id={panel} hidden={!open} className="border-t border-border px-4 py-3">
          {open ? why.panel() : null}
        </div>
      )}
    </Card>
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
            <div
              key={source.id}
              className="grid gap-1.5 rounded-lg border border-border px-3 py-2.5"
            >
              <a
                href={href}
                {...(href && /^https?:/u.test(href)
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="w-fit text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                {source.title}
              </a>
              <blockquote className="m-0 border-l-2 border-border pl-3 leading-relaxed">
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
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableBody>
          {rows.map(([term, value]) => (
            <TableRow key={term}>
              <TableHead scope="row" className="w-[38%] bg-muted/40">
                {term}
              </TableHead>
              <TableCell>{value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
