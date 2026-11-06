"use client";

import type { Citation, Labels } from "@lotse/ui";
import { CitationChip, de } from "@lotse/ui";
import { ShieldCheckIcon } from "lucide-react";
import { type JSX, useId } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card.tsx";

/** Server-side approval request, restyled with the shared card primitives. */
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
    <Card
      aria-labelledby={`${id}-title`}
      aria-busy={pending || undefined}
      className="w-full border-l-4 border-l-brand"
      role="region"
    >
      <CardHeader>
        <CardTitle id={`${id}-title`} className="flex items-center gap-2 text-base">
          <ShieldCheckIcon className="size-5 text-brand" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="m-0 grid list-none gap-1 p-0">
          {[...new Set(changes)].map((change) => (
            <li key={change} className="rounded-xl bg-muted px-3 py-2 text-sm">
              {change}
            </li>
          ))}
        </ul>
        {provenance.length > 0 && (
          <ul aria-label={copy.sources} className="m-0 grid list-none gap-2 p-0 text-sm">
            {provenance.map((source) => (
              <li key={source.id} className="grid gap-1">
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
      </CardContent>
      <CardFooter>
        <Button disabled={pending} onClick={onApprove} aria-describedby={`${id}-hint`}>
          {copy.approve}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={onDecline}
          aria-describedby={`${id}-hint`}
        >
          {copy.decline}
        </Button>
        <p id={`${id}-hint`} className="m-0 basis-full text-xs text-muted-foreground">
          {copy.keyboardHint} {copy.voiceHint}
        </p>
      </CardFooter>
    </Card>
  );
}
