"use client";

import type { LotseMessage } from "@lotse/brain";
import { getToolName, isToolUIPart } from "ai";
import { CalendarClockIcon, CalendarPlusIcon } from "lucide-react";
import type { JSX } from "react";
import { z } from "zod";
import { ResultCard } from "@/components/gen-ui/result-card.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INTL_LOCALES } from "../i18n/config.ts";

// Deadline timeline after Medlyn's gen-ui Timeline (owner's project): dated rows with their
// verbatim source; the next open date is highlighted and can be added to the calendar.
const reminder = z.object({
  id: z.string().min(1),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/u),
  title: z.string().min(1),
  sourceQuote: z.string(),
});
const readers: Readonly<Record<string, (output: unknown) => z.infer<typeof reminder>[]>> = {
  "reminder.list": (output) => z.array(reminder).catch([]).parse(output),
  "reminder.extract": (output) =>
    z
      .object({ reminders: z.array(reminder) })
      .catch({ reminders: [] })
      .parse(output).reminders,
  "reminder.create": (output) => {
    const parsed = reminder.safeParse(output);
    return parsed.success ? [parsed.data] : [];
  },
};
export const DEADLINE_TOOLS = new Set(Object.keys(readers));

const copy = {
  de: {
    title: "Ihre Fristen und Termine",
    saved: "Erinnerung gespeichert",
    next: "Als Nächstes",
    past: "Vorbei",
    calendar: "In Kalender",
    source: "Quelle",
  },
  en: {
    title: "Your deadlines and dates",
    saved: "Reminder saved",
    next: "Next",
    past: "Past",
    calendar: "Add to calendar",
    source: "Source",
  },
} as const;

/** Sourced reminders of completed reminder tools, sorted by date. */
export function deadlineResults(message: LotseMessage, callId?: string) {
  if (message.role !== "assistant") return [];
  return message.parts.flatMap((part) => {
    if (
      !isToolUIPart(part) ||
      part.state !== "output-available" ||
      (callId !== undefined && part.toolCallId !== callId)
    )
      return [];
    const name = getToolName(part);
    const items = readers[name]?.(part.output) ?? [];
    return items.length
      ? [
          {
            callId: part.toolCallId,
            created: name === "reminder.create",
            items: [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
          },
        ]
      : [];
  });
}

function icsHref(item: z.infer<typeof reminder>): string {
  const day = item.dueAt.slice(0, 10).replaceAll("-", "");
  const icsText = (value: string) => value.replace(/([\\,;])/gu, "\\$1").replace(/\n/gu, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SV KI-Lotse//DE",
    "BEGIN:VEVENT",
    `UID:${item.id}@lotse`,
    `DTSTART;VALUE=DATE:${day}`,
    `SUMMARY:${icsText(item.title)}`,
    `DESCRIPTION:${icsText(item.sourceQuote)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export function DeadlineResults({
  message,
  language,
  callId,
  today = new Date().toISOString().slice(0, 10),
}: {
  message: LotseMessage;
  language: "de" | "en";
  callId?: string;
  today?: string;
}): JSX.Element | null {
  const results = deadlineResults(message, callId);
  if (!results.length) return null;
  const text = copy[language];
  const format = new Intl.DateTimeFormat(INTL_LOCALES[language], {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <>
      {results.map((result) => {
        const next = result.items.find((item) => item.dueAt.slice(0, 10) >= today);
        return (
          <ResultCard
            key={result.callId}
            icon={CalendarClockIcon}
            eyebrow={result.created ? text.saved : text.title}
            title={result.created ? (result.items[0]?.title ?? text.title) : text.title}
          >
            <ol className="m-0 grid list-none gap-0 p-0">
              {result.items.map((item, index) => {
                const day = item.dueAt.slice(0, 10);
                const current = item === next;
                const past = day < today;
                return (
                  <li
                    key={item.id}
                    className="relative grid grid-cols-[1.25rem_1fr] gap-3 pb-4 last:pb-0"
                  >
                    {index < result.items.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute top-5 bottom-0 left-[0.55rem] w-px bg-border"
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1 size-3 rounded-full border-2",
                        current
                          ? "border-primary bg-primary ring-4 ring-muted"
                          : past
                            ? "border-muted-foreground/40 bg-muted"
                            : "border-border bg-card",
                      )}
                    />
                    <div
                      className={cn(
                        "grid min-w-0 gap-1",
                        current && "-mx-2 -mt-1.5 rounded-lg bg-muted px-2 py-1.5",
                      )}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <time
                          dateTime={day}
                          className="text-xs font-medium tabular-nums text-muted-foreground"
                        >
                          {format.format(new Date(`${day}T12:00:00`))}
                        </time>
                        {current && <Badge variant="secondary">{text.next}</Badge>}
                        {past && (
                          <span className="text-[0.6875rem] text-muted-foreground">
                            {text.past}
                          </span>
                        )}
                      </div>
                      <p className={cn("m-0 font-medium", past && "text-muted-foreground")}>
                        {item.title}
                      </p>
                      {item.sourceQuote && (
                        <blockquote className="m-0 border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground">
                          {item.sourceQuote}
                        </blockquote>
                      )}
                      {!past && (
                        <Button asChild variant="outline" size="xs" className="mt-0.5 w-fit">
                          <a href={icsHref(item)} download={`${day}-frist.ics`}>
                            <CalendarPlusIcon aria-hidden="true" />
                            {text.calendar}
                          </a>
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </ResultCard>
        );
      })}
    </>
  );
}
