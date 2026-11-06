"use client";
// Ported from Vercel's AI Chatbot template (Apache-2.0); see THIRD_PARTY_NOTICES.md.

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

export const Suggestions = ({ className, children, ...props }: ComponentProps<"div">) => (
  <div
    className={cn(
      "flex w-full gap-2.5 overflow-x-auto pb-1 no-scrollbar sm:grid sm:grid-cols-2 sm:overflow-visible",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  children,
  ...props
}: SuggestionProps) => (
  <Button
    className={cn(
      "h-auto min-w-[200px] shrink-0 justify-start whitespace-nowrap rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-left text-[13px] font-normal leading-relaxed text-foreground/80 transition-all duration-200 hover:-translate-y-0.5 hover:bg-card hover:text-foreground hover:shadow-[var(--shadow-card)] sm:min-w-0 sm:shrink sm:whitespace-normal sm:p-4",
      className,
    )}
    onClick={() => onClick?.(suggestion)}
    variant="outline"
    {...props}
  >
    {children ?? suggestion}
  </Button>
);
