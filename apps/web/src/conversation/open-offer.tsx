"use client";

import type { LotseMessage } from "@lotse/brain";
import { TargetSchema } from "@lotse/protocol";
import { getToolName, isToolUIPart } from "ai";
import { type JSX, useEffect } from "react";
import { z } from "zod";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion.tsx";
import { hasNativeBridge } from "../bridge/index.ts";
import { useI18n } from "../i18n/provider.tsx";
import { loadPortalOrigins, openPortalPageNow } from "./open-resource.ts";

const OfferSchema = z.object({ open: z.boolean(), label: z.string(), target: TargetSchema });
export type OpenOffer = z.infer<typeof OfferSchema>;

export const openOfferCopy = {
  de: {
    yes: "Ja, öffnen",
    no: "Nein",
    noReply: "Nein, sagen Sie mir bitte nur, wo ich es finde.",
    accept: "Ja, bitte",
    decline: "Nein, danke",
  },
  en: {
    yes: "Yes, open it",
    no: "No",
    noReply: "No, just tell me where to find it.",
    accept: "Yes, please",
    decline: "No, thanks",
  },
} as const;

const OFFER_QUESTION =
  /(?:^|[.!?]\s+)(?:soll ich|möchten sie,? dass ich|darf ich|shall i|should i|do you want me to|would you like me to)\b[^.!?]*\?\s*$/iu;

/** The latest assistant message ends with a yes/no offer of a next step ("Soll ich …?"). */
export function pendingOfferQuestion(messages: readonly LotseMessage[]): string | undefined {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return;
  const text = last.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .trim();
  return OFFER_QUESTION.test(text) ? text : undefined;
}

/** The pending "Soll ich … öffnen?" offer of the latest assistant message, if any. */
export function pendingOpenOffer(messages: readonly LotseMessage[]): OpenOffer | undefined {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return;
  for (const part of last.parts.toReversed()) {
    if (!isToolUIPart(part) || getToolName(part) !== "ui.offerResource") continue;
    if (part.state !== "output-available") return;
    const offer = OfferSchema.safeParse(part.output);
    return offer.success && !offer.data.open ? offer.data : undefined;
  }
  return;
}

export function OpenOfferReplies({
  messages,
  onReply,
}: {
  messages: readonly LotseMessage[];
  onReply: (text: string) => void;
}): JSX.Element | null {
  const { locale } = useI18n();
  const offer = pendingOpenOffer(messages);
  // Prefetch so the click can open the page synchronously, inside the user gesture.
  useEffect(() => {
    if (offer?.target.kind === "dom") void loadPortalOrigins();
  }, [offer?.target.kind]);
  const copy = openOfferCopy[locale === "en" ? "en" : "de"];
  if (!offer)
    return pendingOfferQuestion(messages) ? (
      <Suggestions>
        <Suggestion suggestion={copy.accept} onClick={onReply} />
        <Suggestion suggestion={copy.decline} onClick={onReply} />
      </Suggestions>
    ) : null;
  return (
    <Suggestions aria-label={offer.label}>
      <Suggestion
        suggestion={copy.yes}
        onClick={(text) => {
          if (offer.target.kind === "dom" && !hasNativeBridge())
            openPortalPageNow(offer.target.url);
          onReply(text);
        }}
      />
      <Suggestion suggestion={copy.noReply} onClick={onReply}>
        {copy.no}
      </Suggestion>
    </Suggestions>
  );
}
