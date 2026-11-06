import { z } from "zod";
import type { ServerEnvironment } from "../server/env.ts";
import { ANALYTICS_TIMEOUT_MS, POSTHOG_CAPTURE_PATH } from "./config.ts";
import { parseAnalyticsEvent } from "./events.ts";

const envelopeSchema = z
  .object({
    event: z.unknown(),
    properties: z.unknown(),
    anonymousId: z.uuid(),
    consent: z.literal(true),
  })
  .strict();

export async function exportAnalytics(
  raw: unknown,
  config: Pick<ServerEnvironment, "POSTHOG_KEY" | "POSTHOG_HOST">,
): Promise<"disabled" | "invalid" | "sent" | "unavailable"> {
  if (!config.POSTHOG_KEY) return "disabled";
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return "invalid";
  const parsed = parseAnalyticsEvent({
    event: envelope.data.event,
    properties: envelope.data.properties,
  });
  if (!parsed) return "invalid";
  try {
    const response = await fetch(
      new URL(POSTHOG_CAPTURE_PATH, `${config.POSTHOG_HOST.replace(/\/$/, "")}/`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(ANALYTICS_TIMEOUT_MS),
        body: JSON.stringify({
          api_key: config.POSTHOG_KEY,
          event: parsed.event,
          distinct_id: envelope.data.anonymousId,
          properties: {
            ...parsed.properties,
            $process_person_profile: false,
            $geoip_disable: true,
            $ip: null,
          },
        }),
      },
    );
    return response.ok ? "sent" : "unavailable";
  } catch {
    return "unavailable";
  }
}
