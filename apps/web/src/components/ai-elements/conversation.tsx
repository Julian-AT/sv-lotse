"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-x-hidden overflow-y-auto", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn(
      "mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-5 px-2 py-6 md:gap-7 md:px-4",
      className,
    )}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
};

export const ConversationEmptyState = ({
  className,
  title,
  description,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {title && (
      <h3 className="m-0 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
        {title}
      </h3>
    )}
    {description && <p className="m-0 max-w-md text-sm text-muted-foreground">{description}</p>}
    {children}
  </div>
);

export const ConversationScrollButton = ({
  className,
  ...props
}: ComponentProps<typeof Button>) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    !isAtBottom && (
      <Button
        aria-label="Nach unten scrollen"
        className={cn(
          "absolute bottom-4 left-1/2 z-10 h-7 -translate-x-1/2 rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg [&_svg]:size-3 [&_svg]:text-muted-foreground",
          className,
        )}
        onClick={() => void scrollToBottom()}
        variant="outline"
        {...props}
      >
        <ArrowDownIcon />
      </Button>
    )
  );
};
