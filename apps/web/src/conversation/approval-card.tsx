"use client";

import type { Citation, Labels } from "@lotse/ui";
import { CitationChip, de } from "@lotse/ui";
import { ShieldCheckIcon } from "lucide-react";
import { type JSX, useId } from "react";

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
      className="w-full rounded-md border bg-card"
    >
      <div className="flex items-center gap-2 p-3">
        <ShieldCheckIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h4 className="m-0 font-medium text-sm" id={`${id}-title`}>
          {title}
        </h4>
      </div>
      <div className="space-y-3 px-4 pb-3 text-sm">
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {[...new Set(changes)].map((change) => (
            <li className="rounded-md bg-muted/50 px-3 py-2 text-[13px]" key={change}>
              {change}
            </li>
          ))}
        </ul>
        {provenance.length > 0 && (
          <ul aria-label={copy.sources} className="m-0 grid list-none gap-2 p-0 text-xs">
            {provenance.map((source) => (
              <li className="grid gap-1" key={source.id}>
                <CitationChip source={source} />
                {source.quote && (
                  <blockquote className="m-0 border-l-2 border-border pl-3 text-muted-foreground">
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
      <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
        <button
          aria-describedby={`${id}-hint`}
          className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          disabled={pending}
          onClick={onDecline}
          type="button"
        >
          {copy.decline}
        </button>
        <button
          aria-describedby={`${id}-hint`}
          className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
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
