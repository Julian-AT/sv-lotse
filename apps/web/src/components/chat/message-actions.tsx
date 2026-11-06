// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md); votes and edit removed.
import { RotateCcwIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { toast } from "sonner";
import { useCopyToClipboard } from "usehooks-ts";
import type { ChatMessage } from "@/lib/types";
import { MessageAction as Action, MessageActions as Actions } from "../ai-elements/message";
import { CopyIcon } from "./icons";

export function PureMessageActions({
  message,
  isLoading,
  onRetry,
}: {
  message: ChatMessage;
  isLoading: boolean;
  onRetry?: (() => void) | undefined;
}) {
  const [_, copyToClipboard] = useCopyToClipboard();

  const textFromParts = message.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  const handleCopy = useCallback(async () => {
    if (!textFromParts) {
      toast.error("Es gibt keinen Text zum Kopieren.");
      return;
    }

    await copyToClipboard(textFromParts);
    toast.success("In die Zwischenablage kopiert.");
  }, [copyToClipboard, textFromParts]);

  if (isLoading) {
    return null;
  }

  if (message.role === "user") {
    return (
      <Actions className="-mr-0.5 justify-end opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
        <div className="flex items-center gap-0.5">
          <Action
            className="size-7 text-muted-foreground/50 hover:text-foreground"
            onClick={handleCopy}
            tooltip="Kopieren"
          >
            <CopyIcon />
          </Action>
        </div>
      </Actions>
    );
  }

  return (
    <Actions className="-ml-0.5 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100">
      <Action
        className="text-muted-foreground/50 hover:text-foreground"
        onClick={handleCopy}
        tooltip="Kopieren"
      >
        <CopyIcon />
      </Action>
      {onRetry ? (
        <Action
          className="text-muted-foreground/50 hover:text-foreground"
          onClick={onRetry}
          tooltip="Erneut beantworten"
        >
          <RotateCcwIcon />
        </Action>
      ) : null}
    </Actions>
  );
}

export const MessageActions = memo(PureMessageActions);
