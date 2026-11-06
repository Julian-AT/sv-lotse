"use client";

import { type Citation, de } from "@lotse/ui";
import { InfoIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WhyPanel } from "./result-card";

/** Per-answer sources: a quiet "Warum?" button opening the answer's sources with their quotes. */
export function WhyPopover({
  citations,
  label,
  sourcesLabel,
}: {
  citations: readonly Citation[];
  label: string;
  sourcesLabel: string;
}): JSX.Element {
  return (
    <div data-testid="message-sources" className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" className="rounded-full text-muted-foreground">
            <InfoIcon aria-hidden="true" />
            {label}
            <span className="tabular-nums" aria-hidden="true">
              · {citations.length}
            </span>
            <span className="sr-only">
              {citations.length} {sourcesLabel}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="chatbot-root max-h-[min(70vh,32rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-4"
        >
          <WhyPanel sources={citations} labels={{ ...de, why: label }} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
