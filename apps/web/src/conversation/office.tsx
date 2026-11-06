"use client";

import type { LotseMessage } from "@lotse/brain";
import { en, de as uiDe } from "@lotse/ui";
import { getToolName, isToolUIPart } from "ai";
import {
  Building2Icon,
  ClockIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  NavigationIcon,
  PhoneIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { z } from "zod";
import { ResultCard, WhyPanel } from "@/components/gen-ui/result-card.tsx";
import { safeHref } from "@/components/gen-ui/source-chips.tsx";
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

function Channel({
  href,
  icon: Icon,
  label,
  children,
  primary = false,
}: {
  href: string | undefined;
  icon: typeof PhoneIcon;
  label: string;
  children?: ReactNode;
  primary?: boolean;
}): JSX.Element | null {
  if (!href) return null;
  const external = /^https?:/u.test(href);
  return (
    <a
      href={href}
      aria-label={children ? undefined : label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={
        primary
          ? "inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          : "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
      }
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {children ?? label}
    </a>
  );
}

/** Contact card for the sourced server result, independently of generated conversational prose. */
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
  const labels = { ...uiDe, ...(language === "en" ? en : {}) };
  return (
    <>
      {offices.map((office) => {
        const place = `${office.address.street}, ${office.address.postalCode} ${office.address.city}`;
        const route = `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`;
        return (
          <section key={office.callId} aria-label={copy.office}>
            <ResultCard
              icon={Building2Icon}
              eyebrow={copy.office}
              title={office.title}
              why={{
                label: copy.sources,
                subject: office.title,
                panel: () => (
                  <WhyPanel
                    labels={labels}
                    sources={office.sources.map((source, index) => ({
                      ...source,
                      id: `${office.callId}-${index}`,
                      title: new URL(source.url).hostname,
                    }))}
                  />
                ),
              }}
              footer={
                <div className="flex flex-wrap gap-1.5">
                  <Channel
                    primary
                    icon={PhoneIcon}
                    label={copy.call}
                    href={
                      office.channels.phone
                        ? safeHref(`tel:${office.channels.phone.replace(/[^\d+]/gu, "")}`)
                        : undefined
                    }
                  >
                    <span>{office.channels.phone}</span>
                  </Channel>
                  <Channel
                    icon={MailIcon}
                    label={copy.email}
                    href={
                      office.channels.email
                        ? safeHref(`mailto:${office.channels.email}`)
                        : undefined
                    }
                  />
                  <Channel
                    icon={GlobeIcon}
                    label={copy.website}
                    href={
                      office.channels.onlineUrl ? safeHref(office.channels.onlineUrl) : undefined
                    }
                  >
                    {office.channels.onlineUrl && new URL(office.channels.onlineUrl).hostname}
                  </Channel>
                  <Channel icon={NavigationIcon} label={copy.route} href={route} />
                </div>
              }
            >
              <dl className="m-0 grid gap-2.5">
                <div className="flex items-start gap-2.5">
                  <dt className="mt-0.5 text-muted-foreground">
                    <MapPinIcon aria-hidden="true" className="size-4" />
                    <span className="sr-only">{copy.address}</span>
                  </dt>
                  <dd className="m-0">
                    <address className="not-italic leading-relaxed">
                      {office.address.street}
                      <br />
                      {office.address.postalCode} {office.address.city}
                    </address>
                  </dd>
                </div>
                {office.openingHours && (
                  <div className="flex items-start gap-2.5">
                    <dt className="mt-0.5 text-muted-foreground">
                      <ClockIcon aria-hidden="true" className="size-4" />
                      <span className="sr-only">{copy.hours}</span>
                    </dt>
                    <dd className="m-0 leading-relaxed">{office.openingHours}</dd>
                  </div>
                )}
                {office.channels.email && (
                  <div className="flex items-start gap-2.5">
                    <dt className="mt-0.5 text-muted-foreground">
                      <MailIcon aria-hidden="true" className="size-4" />
                      <span className="sr-only">{copy.email}</span>
                    </dt>
                    <dd className="m-0 break-all">{office.channels.email}</dd>
                  </div>
                )}
              </dl>
            </ResultCard>
          </section>
        );
      })}
    </>
  );
}
