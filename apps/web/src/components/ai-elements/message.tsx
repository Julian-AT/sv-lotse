// Ported from Vercel's AI Chatbot template (Apache-2.0); see THIRD_PARTY_NOTICES.md.
import type { UIMessage } from "ai";
import { SparklesIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "@/lib/utils.ts";

export type MessageProps = HTMLAttributes<HTMLDivElement> & { from: UIMessage["role"] };

/** Assistant messages get the template's small sparkles avatar; user messages align right. */
export const Message = ({ className, from, children, ...props }: MessageProps) => (
  <div
    data-role={from}
    data-speaker={from === "user" ? "user" : "assistant"}
    className={cn(
      "group/message w-full",
      from === "user" && "animate-[fade-up_0.25s_ease]",
      className,
    )}
    {...props}
  >
    <div
      className={cn(from === "user" ? "flex flex-col items-end gap-2" : "flex items-start gap-3")}
    >
      {from !== "user" && <MessageAvatar />}
      {from === "user" ? (
        children
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
      )}
    </div>
  </div>
);

export const MessageAvatar = () => (
  <div className="flex h-[calc(13px*1.65)] shrink-0 items-center" aria-hidden="true">
    <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
      <SparklesIcon className="size-3.5" />
    </div>
  </div>
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement> & { from?: UIMessage["role"] };

export const MessageContent = ({ children, className, from, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex min-w-0 flex-col gap-2 overflow-hidden text-sm leading-[1.65] text-foreground",
      from === "user" &&
        "w-fit max-w-[min(80%,56ch)] break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export const MessageToolbar = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
);
