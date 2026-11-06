"use client";

import type { Citation, Labels } from "@lotse/ui";
import { de } from "@lotse/ui";
import { ShieldCheckIcon } from "lucide-react";
import { type JSX, useId } from "react";
import { SourceChip } from "@/components/gen-ui/source-chips.tsx";

/**
 * Server-side approval request in the chatbot template's tool approval style
 * (ToolApprovalActions from Vercel's chatbot template, Apache-2.0; see THIRD_PARTY_NOTICES.md).
 */
export function ApprovalPanel({
  title,
  changes,
  provenance,
  onApprove,
  onDecline,
  pending = false,
  labels,
}: {
  title: string;
  changes: string[];
  provenance: Citation[];
  onApprove: () => void;
  onDecline: () => void;
  pending?: boolean;
  labels?: Partial<Labels>;
}): JSX.Element {
  const id = useId();
  const copy = { ...de, ...labels };
  return (
    <section
      aria-busy={pending || undefined}
      aria-labelledby={`${id}-title`}
      className="fade-up w-full overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-2.5 border-b border-border bg-caution-soft px-4 py-2.5">
        <span className="flex size-6 items-center justify-center rounded-full bg-card text-caution shadow-[var(--shadow-card)]">
          <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
        </span>
        <h4 className="m-0 font-semibold text-[13px]" id={`${id}-title`}>
          {title}
        </h4>
      </div>
      <div className="space-y-3 px-4 py-3 text-sm">
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {[...new Set(changes)].map((change) => (
            <li
              className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-[13px] leading-relaxed"
              key={change}
            >
              {change}
            </li>
          ))}
        </ul>
        {provenance.length > 0 && (
          <ul aria-label={copy.sources} className="m-0 grid list-none gap-2 p-0 text-xs">
            {provenance.map((source) => (
              <li className="grid gap-1.5" key={source.id}>
                <SourceChip source={source} labels={copy} className="w-fit" />
                {source.quote && (
                  <blockquote className="m-0 border-l-2 border-brand/60 pl-3 text-muted-foreground leading-relaxed">
                    {source.quote}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-[11px] text-muted-foreground" id={`${id}-hint`}>
          {copy.keyboardHint} {copy.voiceHint}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
        <button
          aria-describedby={`${id}-hint`}
          className="h-8 rounded-full px-3.5 text-muted-foreground text-[13px] font-medium transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          disabled={pending}
          onClick={onDecline}
          type="button"
        >
          {copy.decline}
        </button>
        <button
          aria-describedby={`${id}-hint`}
          className="h-8 rounded-full bg-primary px-4 text-primary-foreground text-[13px] font-medium shadow-[var(--shadow-card)] transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={pending}
          onClick={onApprove}
          type="button"
        >
          {copy.approve}
        </button>
      </div>
    </section>
  );
}
