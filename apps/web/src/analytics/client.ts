"use client";

import { ANALYTICS_ENDPOINT } from "./config.ts";
import { type AnalyticsEvent, parseAnalyticsEvent } from "./events.ts";

let enabled = false;
let anonymousId: string | undefined;
let pending = new AbortController();

export function setAnalyticsConsent(consent: boolean): void {
  pending.abort();
  pending = new AbortController();
  enabled = consent;
  // No user/session/case identity or persistent tracking identifier.
  anonymousId = consent ? crypto.randomUUID() : undefined;
}

export async function captureAnalytics(event: AnalyticsEvent): Promise<void> {
  if (!enabled || !anonymousId) return;
  const parsed = parseAnalyticsEvent(event);
  if (!parsed) return;
  try {
    await fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...parsed, anonymousId, consent: true }),
      signal: pending.signal,
    });
  } catch {
    // Analytics failure never interrupts an action or conversation.
  }
}
