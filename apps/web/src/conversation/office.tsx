"use client";

import type { LotseMessage } from "@lotse/brain";
import { Card, en, WhyPanel } from "@lotse/ui";
import { getToolName, isToolUIPart } from "ai";
import type { JSX } from "react";
import { z } from "zod";
import { resultCopy } from "./result-copy.ts";

const httpUrl = z.url({ protocol: /^https?$/u });
const officeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  address: z.object({ street: z.string(), postalCode: z.string(), city: z.string() }),
  channels: z.object({
    phone: z.string().optional(),
    email: z.email().optional(),
    onlineUrl: httpUrl.optional(),
  }),
  openingHours: z.string(),
  sources: z.array(z.object({ url: httpUrl, quote: z.string().min(1), asOf: z.iso.date() })).min(1),
});

/** Render the sourced server result, independently of generated conversational prose. */
export function OfficeResults({
  message,
  language,
}: {
  message: LotseMessage;
  language: "de" | "en";
}): JSX.Element | null {
  if (message.role !== "assistant") return null;
  const offices = message.parts.flatMap((part) => {
    if (
      !isToolUIPart(part) ||
      part.state !== "output-available" ||
      getToolName(part) !== "office.resolve"
    )
      return [];
    const parsed = officeSchema.safeParse(part.output);
    return parsed.success ? [{ ...parsed.data, callId: part.toolCallId }] : [];
  });
  const copy = resultCopy[language];
  return (
    <>
      {offices.map((office) => (
        <section key={office.callId} aria-label={copy.office}>
          <Card>
            <h3>{office.title}</h3>
            <address>
              {office.address.street}
              <br />
              {office.address.postalCode} {office.address.city}
            </address>
            {office.channels.phone && <p>{office.channels.phone}</p>}
            {office.channels.email && <p>{office.channels.email}</p>}
            {office.channels.onlineUrl && (
              <p>
                <a href={office.channels.onlineUrl}>
                  {new URL(office.channels.onlineUrl).hostname}
                </a>
              </p>
            )}
            <p>{office.openingHours}</p>
            <details>
              <summary>{copy.sources}</summary>
              <WhyPanel
                labels={language === "en" ? en : {}}
                sources={office.sources.map((source, index) => ({
                  ...source,
                  id: `${office.callId}-${index}`,
                  title: new URL(source.url).hostname,
                }))}
              />
            </details>
          </Card>
        </section>
      ))}
    </>
  );
}
