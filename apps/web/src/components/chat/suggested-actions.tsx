// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md); sends through our transport.
"use client";

import { motion } from "framer-motion";
import { memo, useCallback } from "react";
import { suggestions } from "@/lib/constants";
import { Suggestion } from "../ai-elements/suggestion";

type SuggestedActionsProps = {
  sendMessage: (text: string) => void;
};

function PureSuggestedActions({ sendMessage }: SuggestedActionsProps) {
  const suggestedActions = suggestions;
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      sendMessage(suggestion);
    },
    [sendMessage],
  );

  return (
    <div
      className="flex w-full gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible"
      data-testid="suggested-actions"
      style={{
        msOverflowStyle: "none",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {suggestedActions.map((suggestedAction, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="min-w-[200px] shrink-0 sm:min-w-0 sm:shrink"
          exit={{ opacity: 0, y: 16 }}
          initial={{ opacity: 0, y: 16 }}
          key={suggestedAction}
          transition={{
            delay: 0.06 * index,
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <Suggestion
            className="h-auto w-full whitespace-nowrap rounded-xl border border-border/50 bg-card/30 px-4 py-3 text-left text-[0.75rem] leading-relaxed text-muted-foreground transition-all duration-200 sm:whitespace-normal sm:p-4 sm:text-[0.8125rem] hover:-translate-y-0.5 hover:bg-card/60 hover:text-foreground hover:shadow-[var(--shadow-card)]"
            onClick={handleSuggestionClick}
            suggestion={suggestedAction}
          >
            {suggestedAction}
          </Suggestion>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(PureSuggestedActions);
