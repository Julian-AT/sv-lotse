import { DEFAULT_PREFERENCES } from "@lotse/brain/preferences/schema";
import { afterEach, expect, test, vi } from "vitest";
import { captureAnalytics, setAnalyticsConsent } from "../src/analytics/client.ts";
import { analyticsProperties, parseAnalyticsEvent } from "../src/analytics/events.ts";
import { exportAnalytics } from "../src/analytics/server.ts";
import { savePreferences } from "../src/features/settings/client.ts";

const event = {
  event: "turn_completed",
  properties: {
    language: "de",
    input_mode: "text",
    latency_per_stage: { total: 120, model: 80 },
    tool_count: 2,
  },
} as const;
const envelope = { ...event, consent: true, anonymousId: "337ba7e4-6a07-4868-872f-b796ee0bcb9f" };
const config = { POSTHOG_KEY: "unit-project-key", POSTHOG_HOST: "https://analytics.example" };
afterEach(() => {
  setAnalyticsConsent(false);
  vi.unstubAllGlobals();
});

test("section 15 defines all twenty product events", () => {
  expect(Object.keys(analyticsProperties)).toHaveLength(20);
  expect(parseAnalyticsEvent(event)).toEqual(event);
});

test("section 15 rejects free text, values, personal data and unknown properties", () => {
  for (const properties of [
    { ...event.properties, text: "private content" },
    { ...event.properties, email: "person@example.org" },
    { ...event.properties, latency_per_stage: { total: 1, transcript: "private" } },
    { ...event.properties, tool_count: -1 },
    { ...event.properties, language: "private content" },
  ])
    expect(parseAnalyticsEvent({ event: event.event, properties })).toBeUndefined();
  expect(parseAnalyticsEvent({ event: "$pageview", properties: {} })).toBeUndefined();
  expect(
    parseAnalyticsEvent({
      event: "document_imported",
      properties: { channel: "upload", document_type: "name@example.org", page_count: 1 },
    }),
  ).toBeUndefined();
});

test("no PostHog request occurs without keys or explicit consent", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await captureAnalytics(event);
  expect(
    await exportAnalytics(envelope, { POSTHOG_HOST: config.POSTHOG_HOST, POSTHOG_KEY: undefined }),
  ).toBe("disabled");
  expect(await exportAnalytics({ ...envelope, consent: false }, config)).toBe("invalid");
  expect(fetcher).not.toHaveBeenCalled();
});

test("PostHog receives only validated events and ephemeral identity with profiles and geoip disabled", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await exportAnalytics(envelope, config)).toBe("sent");
  const [url, options] = fetcher.mock.calls[0] ?? [];
  expect(String(url)).toBe("https://analytics.example/i/v0/e/");
  expect(JSON.parse(options.body)).toEqual({
    api_key: config.POSTHOG_KEY,
    event: event.event,
    distinct_id: envelope.anonymousId,
    properties: {
      ...event.properties,
      $process_person_profile: false,
      $geoip_disable: true,
      $ip: null,
    },
  });
  expect(options.headers).toEqual({ "Content-Type": "application/json" });
});

test("revoking consent aborts pending capture and stops new events", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  setAnalyticsConsent(true);
  await captureAnalytics(event);
  expect(fetcher).toHaveBeenCalledOnce();
  const signal = fetcher.mock.calls[0]?.[1].signal;
  setAnalyticsConsent(false);
  expect(signal.aborted).toBe(true);
  await captureAnalytics(event);
  expect(fetcher).toHaveBeenCalledOnce();
});

test("saving onboarding or settings consent enables capture only after a successful save", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ ...DEFAULT_PREFERENCES, analyticsConsent: true }));
  vi.stubGlobal("fetch", fetcher);
  await savePreferences({ analyticsConsent: true, onboardingCompleted: true });
  await captureAnalytics(event);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[0]).toBe("/api/analytics");
});

test("failed consent saves cannot enable capture and revocation immediately stops capture", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(savePreferences({ analyticsConsent: true })).rejects.toThrow("SETTINGS_SAVE_FAILED");
  await captureAnalytics(event);
  expect(fetcher).toHaveBeenCalledOnce();
  setAnalyticsConsent(true);
  await expect(savePreferences({ analyticsConsent: false })).rejects.toThrow(
    "SETTINGS_SAVE_FAILED",
  );
  await captureAnalytics(event);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("provider failures do not propagate into product actions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sensitive provider error")));
  expect(await exportAnalytics(envelope, config)).toBe("unavailable");
  setAnalyticsConsent(true);
  await expect(captureAnalytics(event)).resolves.toBeUndefined();
});

test("analytics consent rejects absent, disabled and ambiguous preference cookies", async () => {
  const { hasAnalyticsConsent } = await import("../src/analytics/consent.ts");
  for (const cookie of [
    "",
    "lotse_analytics_enabled=0",
    "lotse_analytics_enabled=1; lotse_analytics_enabled=0",
    "lotse_analytics_enabled=1; lotse_analytics_enabled=1",
    "other_lotse_analytics_enabled=1",
  ]) {
    expect(hasAnalyticsConsent(new Request("https://lotse.example", { headers: { cookie } }))).toBe(
      false,
    );
  }
  expect(
    hasAnalyticsConsent(
      new Request("https://lotse.example", {
        headers: { cookie: "lotse_analytics_enabled=1; preference=de" },
      }),
    ),
  ).toBe(true);
});
