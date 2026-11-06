"use client";

import type { LotseMessage } from "@lotse/brain";
import { autonomyConfirmationMetadata } from "@lotse/brain/autonomy/schema";
import { type ReactElement, useId, useState } from "react";
import { autonomyCopy } from "./copy.ts";

export function AutonomyConfirmation({
  message,
  language,
  active,
  onDecision,
}: {
  message: LotseMessage;
  language: "de" | "en";
  active: boolean;
  onDecision: (text: string) => Promise<void>;
}): ReactElement | null {
  const parsed = autonomyConfirmationMetadata.safeParse(message.metadata);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = useId();
  if (message.role !== "assistant" || !active || !parsed.success) return null;
  const copy = autonomyCopy[language];
  const decide = async (text: string): Promise<void> => {
    setPending(true);
    setFailed(false);
    try {
      await onDecision(text);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      aria-labelledby={id}
      aria-busy={pending}
      className="fade-up w-full overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]"
    >
      <div className="grid gap-1 px-4 pt-3.5 pb-3">
        <h3 id={id} className="m-0 text-[14px] font-semibold">
          {copy.confirmationTitle}
        </h3>
        <p className="m-0 text-[13px] text-muted-foreground leading-relaxed">
          {copy.confirmationText(copy.levels[parsed.data.autonomyConfirmation.level])}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => void decide(copy.declineMessage)}
          className="h-8 rounded-full px-3.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          {copy.decline}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void decide(copy.confirmationMessage)}
          className="h-8 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-[var(--shadow-card)] transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {copy.confirm}
        </button>
      </div>
      {failed && (
        <p role="alert" className="m-0 px-4 pb-3 text-xs text-destructive">
          {copy.error}
        </p>
      )}
    </section>
  );
}
