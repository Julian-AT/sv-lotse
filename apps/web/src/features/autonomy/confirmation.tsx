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
    <section aria-labelledby={id} aria-busy={pending}>
      <h3 id={id}>{copy.confirmationTitle}</h3>
      <p>{copy.confirmationText(copy.levels[parsed.data.autonomyConfirmation.level])}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => void decide(copy.confirmationMessage)}
      >
        {copy.confirm}
      </button>
      <button type="button" disabled={pending} onClick={() => void decide(copy.declineMessage)}>
        {copy.decline}
      </button>
      {failed && <p role="alert">{copy.error}</p>}
    </section>
  );
}
