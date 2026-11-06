"use client";

import type { LotseMessage } from "@lotse/brain";
import { autonomyConfirmationMetadata } from "@lotse/brain/autonomy/schema";
import { type ReactElement, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <section aria-labelledby={id} aria-busy={pending} className="w-full">
      <Card className="fade-up gap-3 pb-0">
        <CardHeader>
          <CardTitle id={id} role="heading" aria-level={3}>
            {copy.confirmationTitle}
          </CardTitle>
          <CardDescription className="text-[13px] leading-relaxed">
            {copy.confirmationText(copy.levels[parsed.data.autonomyConfirmation.level])}
          </CardDescription>
        </CardHeader>
        {failed && (
          <CardContent>
            <p role="alert" className="m-0 text-xs text-destructive">
              {copy.error}
            </p>
          </CardContent>
        )}
        <CardFooter className="justify-end gap-2 border-t border-border py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void decide(copy.declineMessage)}
          >
            {copy.decline}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => void decide(copy.confirmationMessage)}
          >
            {copy.confirm}
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}
