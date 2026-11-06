// One collapsed AI Elements tool row per call (name + status); parameters and result open on demand.
// Result-producing tools show a skeleton of their card while they run.
"use client";

import type { JSX } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolState,
} from "../ai-elements/tool";

const COPY = {
  de: {
    status: {
      "approval-requested": "Wartet auf Freigabe",
      "approval-responded": "Entschieden",
      "input-available": "Läuft…",
      "input-streaming": "Läuft…",
      "output-available": "Fertig",
      "output-denied": "Abgelehnt",
      "output-error": "Fehler",
    },
    parameters: "Parameter",
    result: "Ergebnis",
    error: "Fehler",
    loading: "Ergebnis wird geladen",
  },
  en: {
    status: {
      "approval-requested": "Waiting for approval",
      "approval-responded": "Decided",
      "input-available": "Running…",
      "input-streaming": "Running…",
      "output-available": "Done",
      "output-denied": "Declined",
      "output-error": "Error",
    },
    parameters: "Parameters",
    result: "Result",
    error: "Error",
    loading: "Loading result",
  },
} as const satisfies Record<
  "de" | "en",
  {
    status: Record<ToolState, string>;
    parameters: string;
    result: string;
    error: string;
    loading: string;
  }
>;

export function ToolStep({
  state,
  title,
  language,
  input,
  output,
  errorText,
  skeleton = false,
}: {
  state: ToolState;
  title: string;
  language: "de" | "en";
  input?: unknown;
  output?: unknown;
  errorText?: string | undefined;
  /** The tool produces a result card: show its skeleton while it runs. */
  skeleton?: boolean;
}): JSX.Element {
  const running = state === "input-streaming" || state === "input-available";
  const copy = COPY[language];
  return (
    <div className="grid gap-2" data-tool-state={state}>
      <Tool>
        <ToolHeader title={title} state={state} status={copy.status[state]} />
        <ToolContent>
          <ToolInput input={input} label={copy.parameters} />
          <ToolOutput
            output={output}
            errorText={errorText}
            label={copy.result}
            errorLabel={copy.error}
          />
        </ToolContent>
      </Tool>
      {running && skeleton && <ResultSkeleton label={copy.loading} />}
    </div>
  );
}

/** Card-shaped placeholder, after Medlyn's ToolSkeleton. */
export function ResultSkeleton({ label }: { label: string }): JSX.Element {
  return (
    <Card role="img" aria-label={label} className="w-full gap-3 px-4">
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
    </Card>
  );
}
