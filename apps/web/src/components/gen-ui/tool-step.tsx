// Tool progress after Medlyn's chat tool steps (owner's project): each tool call is one quiet step
// line (running, waiting, done, failed) instead of a raw input/output card; result-producing tools
// show a skeleton of their card while they run.
"use client";

import type { ToolUIPart } from "ai";
import { BanIcon, CheckIcon, LoaderCircleIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import type { JSX } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Shimmer } from "../ai-elements/shimmer";

type State = ToolUIPart["state"];

const STATUS = {
  de: {
    "approval-requested": "Wartet auf Ihre Freigabe",
    "approval-responded": "Entschieden",
    "input-available": "Läuft",
    "input-streaming": "Wird vorbereitet",
    "output-available": "Erledigt",
    "output-denied": "Abgelehnt",
    "output-error": "Fehlgeschlagen",
    loading: "Ergebnis wird geladen",
  },
  en: {
    "approval-requested": "Waiting for your approval",
    "approval-responded": "Decided",
    "input-available": "Running",
    "input-streaming": "Preparing",
    "output-available": "Done",
    "output-denied": "Declined",
    "output-error": "Failed",
    loading: "Loading result",
  },
} as const satisfies Record<"de" | "en", Record<State | "loading", string>>;

function StepIcon({ state }: { state: State }): JSX.Element {
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full";
  switch (state) {
    case "output-available":
    case "approval-responded":
      return (
        <span className={cn(base, "bg-brand-soft text-brand-text")}>
          <CheckIcon aria-hidden="true" className="size-3" strokeWidth={2.5} />
        </span>
      );
    case "approval-requested":
      return (
        <span className={cn(base, "bg-caution-soft text-caution")}>
          <ShieldAlertIcon aria-hidden="true" className="size-3" />
        </span>
      );
    case "output-error":
      return (
        <span className={cn(base, "bg-destructive/10 text-destructive")}>
          <XIcon aria-hidden="true" className="size-3" strokeWidth={2.5} />
        </span>
      );
    case "output-denied":
      return (
        <span className={cn(base, "bg-muted text-muted-foreground")}>
          <BanIcon aria-hidden="true" className="size-3" />
        </span>
      );
    default:
      return (
        <span className={cn(base, "text-muted-foreground")}>
          <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
        </span>
      );
  }
}

export function ToolStep({
  state,
  title,
  language,
  errorText,
  skeleton = false,
}: {
  state: State;
  title: string;
  language: "de" | "en";
  errorText?: string | undefined;
  /** The tool produces a result card: show its skeleton while it runs. */
  skeleton?: boolean;
}): JSX.Element {
  const running = state === "input-streaming" || state === "input-available";
  const status = STATUS[language];
  return (
    <div className="grid gap-2">
      <div
        className="flex min-h-7 items-center gap-2 text-[13px]"
        data-state={state}
        {...(running ? { role: "status" } : {})}
      >
        <StepIcon state={state} />
        <span
          className={cn(
            "min-w-0 truncate",
            state === "output-available" ? "text-muted-foreground" : "font-medium",
          )}
        >
          {running ? (
            <Shimmer as="span" duration={1.5}>
              {title}
            </Shimmer>
          ) : (
            title
          )}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 text-[11px]",
            state === "approval-requested" ? "font-medium text-caution" : "text-muted-foreground",
          )}
        >
          {status[state]}
        </span>
      </div>
      {state === "output-error" && errorText && (
        <p className="m-0 ml-7 text-xs text-destructive">{errorText}</p>
      )}
      {running && skeleton && <ResultSkeleton label={status.loading} />}
    </div>
  );
}

/** Card-shaped placeholder, after Medlyn's ToolSkeleton. */
export function ResultSkeleton({ label }: { label: string }): JSX.Element {
  return (
    <div
      role="img"
      aria-label={label}
      className="grid w-full gap-3 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-lg" />
        <div className="grid flex-1 gap-1.5">
          <Skeleton className="h-2.5 w-24 rounded-full" />
          <Skeleton className="h-3.5 w-2/3 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="grid gap-2">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}
