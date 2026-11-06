import type { AnalyticsEvent } from "./events.ts";

type Event<Name extends AnalyticsEvent["event"]> = Extract<AnalyticsEvent, { event: Name }>;

/** A new case has no classified life situation yet; classification happens in conversation. */
export function caseStarted(): Event<"case_started"> {
  return {
    event: "case_started",
    properties: { life_situation: "unclassified", actor_role: "subject" },
  };
}

/** The document type is the media subtype (pdf, png, jpeg, webp), never the user-supplied label. */
export function documentImported(
  channel: Event<"document_imported">["properties"]["channel"],
  mediaType: string,
  pageCount: number,
): Event<"document_imported"> {
  return {
    event: "document_imported",
    properties: {
      channel,
      document_type: mediaType.split("/")[1] ?? "unknown",
      page_count: pageCount,
    },
  };
}

export function factsConfirmed(factType: string, edited: boolean): Event<"facts_confirmed"> {
  return {
    event: "facts_confirmed",
    properties: { fact_type_counts: { [factType]: 1 }, edited_count: edited ? 1 : 0 },
  };
}

export function handoffCreated(): Event<"handoff_created"> {
  return { event: "handoff_created", properties: { reason_category: "user_request" } };
}

export const ONBOARDING_STEPS = ["language", "accessibility", "control", "tutorial"] as const;
export function onboardingStepCompleted(
  step: number,
  startedAt: number,
  now: number,
): Event<"onboarding_step_completed"> {
  return {
    event: "onboarding_step_completed",
    properties: {
      step: ONBOARDING_STEPS[step] ?? "unknown",
      duration: Math.max(0, Math.round(now - startedAt)),
    },
  };
}
