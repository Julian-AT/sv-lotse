"use client";

import type { ToolUIPart } from "ai";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ToolState = ToolUIPart["state"];

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose w-full rounded-md border bg-card", className)}
    {...props}
  />
);

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  state: ToolState;
  status: string;
};

export const ToolHeader = ({ className, title, state, status, ...props }: ToolHeaderProps) => {
  const running = state === "input-streaming" || state === "input-available";
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <WrenchIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-medium">{title}</span>
      <Badge
        variant={state === "output-error" ? "destructive" : running ? "outline" : "secondary"}
        className="ml-auto shrink-0 font-normal"
        {...(running ? { role: "status" } : {})}
      >
        {status}
      </Badge>
      <ChevronDownIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent className={cn("grid gap-3 border-t p-3", className)} {...props} />
);

function ToolCode({
  label,
  code,
  error = false,
}: {
  label: string;
  code: string;
  error?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <h4 className="m-0 text-xs font-medium text-muted-foreground">{label}</h4>
      <pre
        className={cn(
          "m-0 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {code}
      </pre>
    </div>
  );
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export const ToolInput = ({ input, label }: { input: unknown; label: string }) =>
  input === undefined ? null : <ToolCode label={label} code={stringify(input)} />;

export type ToolOutputProps = {
  output: unknown;
  errorText?: string | undefined;
  label: string;
  errorLabel: string;
};

export const ToolOutput = ({ output, errorText, label, errorLabel }: ToolOutputProps) => {
  if (errorText) return <ToolCode label={errorLabel} code={errorText} error />;
  if (output === undefined) return null;
  return <ToolCode label={label} code={stringify(output)} />;
};
