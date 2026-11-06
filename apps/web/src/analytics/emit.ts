import { randomUUID } from "node:crypto";
import type { ProductEvent } from "@lotse/brain/telemetry";
import { getEnvironment } from "../server/env.ts";
import { hasAnalyticsConsent } from "./consent.ts";
import type { AnalyticsEvent } from "./events.ts";
import { exportAnalytics } from "./server.ts";

type ServerEvent = AnalyticsEvent | ProductEvent;

/**
 * Server-side product analytics for one request. Consent is read once from the request cookie;
 * without it nothing is configured or sent. Every event is validated again by the exporter.
 */
export function analyticsSink(request: Request): (event: ServerEvent) => Promise<void> {
  const consent = hasAnalyticsConsent(request);
  return async (event) => {
    if (!consent) return;
    try {
      await exportAnalytics(
        {
          event: event.event,
          properties: event.properties,
          consent: true,
          anonymousId: randomUUID(),
        },
        getEnvironment(),
      );
    } catch {
      // Analytics never interrupts a product action.
    }
  };
}

export function emitAnalytics(request: Request, event: ServerEvent): Promise<void> {
  return analyticsSink(request)(event);
}
