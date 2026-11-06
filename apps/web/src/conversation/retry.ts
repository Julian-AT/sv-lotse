import type { UIMessage } from "ai";

/** A retry is a new user attempt; replaying a persisted message ID is rejected by the brain. */
export function retryUserText(messages: readonly UIMessage[]): string | undefined {
  const text = messages
    .findLast((message) => message.role === "user")
    ?.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  return text || undefined;
}
