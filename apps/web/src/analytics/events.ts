import { z } from "zod";
import { ANALYTICS_MAX_COUNT, ANALYTICS_MAX_DURATION_MS } from "./config.ts";

// Identifiers must come from the catalog/protocol, never from user input.
const identifier = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const count = z.number().int().min(0).max(ANALYTICS_MAX_COUNT);
const duration = z.number().finite().min(0).max(ANALYTICS_MAX_DURATION_MS);
const autonomy = z.enum(["L1", "L2", "L3"]);
const action = z
  .object({
    action_type: identifier,
    target_method: z.enum(["ax", "dom", "ocr", "vision", "api", "manual"]),
    autonomy_level: autonomy,
  })
  .strict();
const appointment = z
  .object({
    channel_type: z.enum(["phone", "email", "online", "in_person"]),
    preference_count: count,
  })
  .strict();
const helper = z
  .object({
    duration,
    approvals_given: count,
    share_scope: z.enum(["case", "facts", "screen", "full", "restricted"]),
  })
  .strict();

export const analyticsProperties = {
  onboarding_step_completed: z.object({ step: identifier, duration }).strict(),
  turn_completed: z
    .object({
      language: z.enum(["de", "de-simple", "en", "tr", "bs", "hr", "sr", "other"]),
      input_mode: z.enum(["text", "voice"]),
      latency_per_stage: z
        .object({
          total: duration,
          stt: duration.optional(),
          classification: duration.optional(),
          safety_net: duration.optional(),
          context: duration.optional(),
          model: duration.optional(),
          tools: duration.optional(),
          retrieval: duration.optional(),
          guard: duration.optional(),
          verifier: duration.optional(),
          tts: duration.optional(),
        })
        .strict(),
      tool_count: count,
    })
    .strict(),
  goal_confirmed: z.object({ life_situation: identifier, turns_to_confirmation: count }).strict(),
  case_started: z
    .object({ life_situation: identifier, actor_role: z.enum(["subject", "helper"]) })
    .strict(),
  process_step_completed: z
    .object({
      benefit_id: identifier,
      step_id: identifier,
      autonomy_level: autonomy,
      initiated_by: z.enum(["user", "agent", "helper"]),
    })
    .strict(),
  action_proposed: action,
  action_approved: action,
  action_rejected: action,
  document_imported: z
    .object({
      channel: z.enum(["upload", "camera", "screen", "file"]),
      document_type: identifier,
      page_count: count,
    })
    .strict(),
  facts_confirmed: z
    .object({ fact_type_counts: z.record(identifier, count), edited_count: count })
    .strict(),
  documents_checked: z
    .object({ benefit_id: identifier, have_count: count, missing_count: count })
    .strict(),
  appointment_searched: appointment,
  appointment_prepared: appointment,
  form_prefilled: z
    .object({ form_id: identifier, fields_filled: count, fields_missing: count })
    .strict(),
  package_built: z.object({ form_id: identifier, attachment_count: count }).strict(),
  handoff_created: z.object({ reason_category: identifier }).strict(),
  helper_session_started: helper,
  helper_session_ended: helper,
  boundary_guard_triggered: z.object({ layer: identifier, category: identifier }).strict(),
  safety_net_triggered: z.object({ pattern_category: identifier }).strict(),
} as const;
export type AnalyticsEventName = keyof typeof analyticsProperties;
export type AnalyticsEvent = {
  [Name in AnalyticsEventName]: {
    event: Name;
    properties: z.infer<(typeof analyticsProperties)[Name]>;
  };
}[AnalyticsEventName];

export function parseAnalyticsEvent(raw: unknown): AnalyticsEvent | undefined {
  const envelope = z
    .object({
      event: z.enum(
        Object.keys(analyticsProperties) as [AnalyticsEventName, ...AnalyticsEventName[]],
      ),
      properties: z.unknown(),
    })
    .strict()
    .safeParse(raw);
  if (!envelope.success) return;
  const properties = analyticsProperties[envelope.data.event].safeParse(envelope.data.properties);
  if (!properties.success) return;
  return { event: envelope.data.event, properties: properties.data } as AnalyticsEvent;
}
