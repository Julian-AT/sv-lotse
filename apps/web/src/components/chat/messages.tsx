// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md); votes, artifacts and
// the data stream handler removed, message props are SV KI-Lotse's.
import type { ApprovalContext } from "@lotse/protocol";
import { ArrowDownIcon } from "lucide-react";
import { useCallback } from "react";
import type { PassageDates } from "@/conversation/sources.ts";
import { useMessages } from "@/hooks/use-messages";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";

type MessagesProps = {
  status: "submitted" | "streaming" | "ready" | "error";
  messages: ChatMessage[];
  subjectId: string;
  contexts: ApprovalContext[];
  passageDates: PassageDates;
  busyLabel: string;
  greeting: { title: string; subtitle: string };
  onApproval: (id: string, approved: boolean) => void;
  onAutonomyDecision: (text: string) => Promise<void>;
  onRetry?: (() => void) | undefined;
  children?: React.ReactNode;
};

function PureMessages({
  status,
  messages,
  subjectId,
  contexts,
  passageDates,
  busyLabel,
  greeting,
  onApproval,
  onAutonomyDecision,
  onRetry,
  children,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
  } = useMessages({
    status,
  });

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="relative flex-1 bg-page">
      {messages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Greeting subtitle={greeting.subtitle} title={greeting.title} />
        </div>
      )}
      <div
        aria-busy={busy}
        className={cn(
          "absolute inset-0 touch-pan-y overflow-y-auto",
          messages.length > 0 ? "bg-page" : "bg-transparent",
        )}
        ref={messagesContainerRef}
        role="log"
      >
        <div className="mx-auto flex min-h-full min-w-0 max-w-4xl flex-col gap-5 px-2 pt-6 pb-16 md:gap-7 md:px-4">
          {messages.map((message, index) => (
            <PreviewMessage
              actionable={index === messages.length - 1 && !busy}
              busyLabel={busyLabel}
              contexts={contexts}
              isLoading={busy && messages.length - 1 === index}
              key={message.id}
              message={message}
              onApproval={onApproval}
              onAutonomyDecision={onAutonomyDecision}
              onRetry={
                index === messages.length - 1 && message.role === "assistant" ? onRetry : undefined
              }
              passageDates={passageDates}
              subjectId={subjectId}
            />
          ))}

          {status === "submitted" && messages.at(-1)?.role !== "assistant" && (
            <ThinkingMessage label={busyLabel} />
          )}

          {children}

          <div className="min-h-[24px] min-w-[24px] shrink-0" ref={messagesEndRef} />
        </div>
      </div>

      <button
        aria-label="Nach unten scrollen"
        className={`absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg transition-all duration-200 h-7 text-[0.625rem] ${
          isAtBottom
            ? "pointer-events-none scale-90 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        }`}
        onClick={handleScrollToBottom}
        type="button"
      >
        <ArrowDownIcon className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}

export const Messages = PureMessages;
