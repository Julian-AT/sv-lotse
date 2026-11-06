"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, KeyboardEventHandler } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { cn } from "@/lib/utils.ts";

export const PromptInput = ({ className, ...props }: HTMLAttributes<HTMLFormElement>) => (
  <form
    className={cn(
      "glass w-full overflow-hidden rounded-2xl border border-border/60 shadow-[var(--shadow-composer)] transition-shadow duration-300 focus-within:shadow-[var(--shadow-composer-focus)]",
      className,
    )}
    {...props}
  />
);

export const PromptInputTextarea = ({
  className,
  onKeyDown,
  ...props
}: ComponentProps<typeof Textarea>) => {
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  return (
    <Textarea
      className={cn(
        "max-h-48 min-h-24 resize-none border-none bg-transparent px-4 pt-3.5 pb-1.5 text-sm leading-relaxed shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0",
        className,
      )}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

export const PromptInputToolbar = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center justify-between gap-1 px-3 pb-3", className)} {...props} />
);

export const PromptInputTools = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
);

export const PromptInputButton = ({ className, ...props }: ComponentProps<typeof Button>) => (
  <Button
    className={cn("size-8 rounded-lg border border-border/60 p-1 text-foreground", className)}
    size="icon-sm"
    variant="ghost"
    {...props}
  />
);

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: "submitted" | "streaming" | "ready" | "error";
};

export const PromptInputSubmit = ({
  className,
  status,
  children,
  ...props
}: PromptInputSubmitProps) => (
  <Button
    className={cn(
      "size-8 rounded-xl bg-foreground text-background hover:opacity-85 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
      className,
    )}
    size="icon-sm"
    type="submit"
    {...props}
  >
    {children ?? (status === "streaming" ? <SquareIcon /> : <ArrowUpIcon />)}
  </Button>
);
