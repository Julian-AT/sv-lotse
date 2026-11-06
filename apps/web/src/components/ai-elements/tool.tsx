"use client";

import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.tsx";
import { cn } from "@/lib/utils.ts";

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export const Tool = ({ className, ...props }: ComponentProps<typeof Collapsible>) => (
  <Collapsible
    className={cn("group w-full min-w-0 rounded-lg border border-border bg-card", className)}
    {...props}
  />
);

const stateLabel: Record<ToolState, { de: string; en: string; icon: ReactNode }> = {
  "input-streaming": { de: "Wird vorbereitet", en: "Preparing", icon: <CircleIcon /> },
  "input-available": {
    de: "Läuft",
    en: "Running",
    icon: <ClockIcon className="animate-pulse motion-reduce:animate-none" />,
  },
  "approval-requested": { de: "Wartet auf Freigabe", en: "Awaiting approval", icon: <ClockIcon /> },
  "approval-responded": { de: "Entschieden", en: "Decided", icon: <CheckCircleIcon /> },
  "output-available": {
    de: "Erledigt",
    en: "Done",
    icon: <CheckCircleIcon className="text-primary" />,
  },
  "output-error": { de: "Fehler", en: "Error", icon: <XCircleIcon className="text-destructive" /> },
  "output-denied": { de: "Abgelehnt", en: "Declined", icon: <XCircleIcon /> },
};

export const ToolHeader = ({
  title,
  state,
  language = "de",
  className,
}: {
  title: string;
  state: ToolState;
  language?: "de" | "en";
  className?: string;
}) => {
  const status = stateLabel[state];
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg border-0 bg-transparent p-3 text-left text-sm text-foreground",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <WrenchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate font-medium">{title}</span>
        <Badge variant="secondary" className="gap-1.5 rounded-full text-xs [&>svg]:size-3.5">
          {status.icon}
          {status[language]}
        </Badge>
      </span>
      <ChevronDownIcon
        className="size-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180"
        aria-hidden="true"
      />
    </CollapsibleTrigger>
  );
};

export const ToolContent = ({ className, ...props }: ComponentProps<typeof CollapsibleContent>) => (
  <CollapsibleContent
    className={cn(
      "grid gap-3 border-t border-border p-4 text-sm data-[state=closed]:hidden",
      className,
    )}
    {...props}
  />
);

export const ToolCode = ({ label, value }: { label: string; value: unknown }) => (
  <div className="grid gap-1">
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <pre className="m-0 max-h-60 overflow-auto rounded-xl bg-muted p-3 text-xs">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  </div>
);
