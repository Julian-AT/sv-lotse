"use client";

import type { Citation, Labels } from "@lotse/ui";
import { de } from "@lotse/ui";
import { ShieldCheckIcon } from "lucide-react";
import { type JSX, useId } from "react";
import { SourceChip } from "@/components/gen-ui/source-chips.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

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
    <section aria-busy={pending || undefined} aria-labelledby={`${id}-title`} className="w-full">
      <Card className="fade-up gap-3 pb-0">
        <CardHeader className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60"
          >
            <ShieldCheckIcon className="size-4" />
          </span>
          <CardTitle className="flex-1" id={`${id}-title`} role="heading" aria-level={4}>
            {title}
          </CardTitle>
          <Badge variant="outline">{copy.pending}</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {[...new Set(changes)].map((change) => (
              <li
                className="rounded-lg border border-border px-3 py-2 text-[13px] leading-relaxed"
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
                    <blockquote className="m-0 border-l-2 border-border pl-3 leading-relaxed text-muted-foreground">
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
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t border-border py-3">
          <Button
            aria-describedby={`${id}-hint`}
            disabled={pending}
            onClick={onDecline}
            type="button"
            variant="outline"
            size="sm"
          >
            {copy.decline}
          </Button>
          <Button
            aria-describedby={`${id}-hint`}
            disabled={pending}
            onClick={onApprove}
            type="button"
            size="sm"
          >
            {copy.approve}
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}
