import { TargetSchema } from "@lotse/protocol";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import type { GuardedResponse, ResponseGuardInput } from "../guards/response.ts";
import { contracts } from "../tools/contracts/index.ts";

type AutonomyLevel = RuntimeContext["autonomyLevel"];
type ActionEventName = "action_proposed" | "action_approved" | "action_rejected";
type TargetMethod = "ax" | "dom" | "ocr" | "vision" | "api" | "manual";
export type HelperShareScope = "case" | "facts" | "screen" | "full" | "restricted";
type HelperSession = { duration: number; approvals_given: number; share_scope: HelperShareScope };

/**
 * Product analytics raised by the brain (PRD section 15). Mirrors the web taxonomy, which
 * validates every event again before export: ids, types and counts only, never content.
 */
export type ProductEvent =
  | {
      event: ActionEventName;
      properties: {
        action_type: string;
        target_method: TargetMethod;
        autonomy_level: AutonomyLevel;
      };
    }
  | {
      event: "process_step_completed";
      properties: {
        benefit_id: string;
        step_id: string;
        autonomy_level: AutonomyLevel;
        initiated_by: "user" | "agent" | "helper";
      };
    }
  | {
      event: "form_prefilled";
      properties: { form_id: string; fields_filled: number; fields_missing: number };
    }
  | { event: "package_built"; properties: { form_id: string; attachment_count: number } }
  | { event: "handoff_created"; properties: { reason_category: string } }
  | { event: "helper_session_started" | "helper_session_ended"; properties: HelperSession }
  | { event: "safety_net_triggered"; properties: { pattern_category: string } }
  | { event: "boundary_guard_triggered"; properties: { layer: string; category: string } };
/** Injected by the host. The brain never decides consent and never awaits delivery. */
export type ProductEventSink = (event: ProductEvent) => void | Promise<void>;

/** Best effort: a missing, throwing or rejecting sink never interrupts a product action. */
export function emitProductEvent(
  sink: ProductEventSink | undefined,
  event: ProductEvent | undefined,
): void {
  if (!sink || !event) return;
  try {
    void Promise.resolve(sink(event)).catch(() => undefined);
  } catch {
    // Analytics failures are deliberately ignored.
  }
}

/** Holds events raised inside a transaction until it commits; later events pass straight on. */
export function heldUntilCommit(sink: ProductEventSink | undefined): {
  sink: ProductEventSink;
  commit: () => void;
} {
  let held: ProductEvent[] | undefined = [];
  return {
    sink: (event) => {
      if (held) held.push(event);
      else emitProductEvent(sink, event);
    },
    commit: () => {
      const events = held ?? [];
      held = undefined;
      for (const event of events) emitProductEvent(sink, event);
    },
  };
}

/** Dotted camelCase tool names become taxonomy identifiers (form.commitGroup → form.commit_group). */
export function analyticsIdentifier(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Registry template ids are UUIDs; the prefix keeps them valid taxonomy identifiers. */
export function formIdentifier(templateId: string): string {
  return `form-${templateId.toLowerCase()}`;
}

const targetMethods = {
  ui: "dom",
  form: "dom",
  dom: "dom",
  ax: "ax",
  text: "ocr",
  point: "vision",
} as const satisfies Record<z.infer<typeof TargetSchema>["kind"], TargetMethod>;
const targetInput = z.object({ target: TargetSchema });

export function actionEvent(
  event: ActionEventName,
  call: { toolName: string; input: unknown },
  autonomyLevel: AutonomyLevel,
): ProductEvent {
  const target = targetInput.safeParse(call.input);
  return {
    event,
    properties: {
      action_type: analyticsIdentifier(call.toolName),
      target_method: target.success ? targetMethods[target.data.target.kind] : "api",
      autonomy_level: autonomyLevel,
    },
  };
}

export function stepCompletedEvent(
  benefitId: string,
  stepId: string,
  context: Pick<RuntimeContext, "actorRole" | "autonomyLevel">,
): ProductEvent {
  return {
    event: "process_step_completed",
    properties: {
      benefit_id: benefitId,
      step_id: stepId,
      autonomy_level: context.autonomyLevel,
      initiated_by: context.actorRole === "helper" ? "helper" : "agent",
    },
  };
}

export function packageBuiltEvent(templateId: string, attachmentCount: number): ProductEvent {
  return {
    event: "package_built",
    properties: { form_id: formIdentifier(templateId), attachment_count: attachmentCount },
  };
}

export function helperSessionEvent(
  event: "helper_session_started" | "helper_session_ended",
  share_scope: HelperShareScope,
  durationMs = 0,
): ProductEvent {
  return {
    event,
    properties: { duration: Math.max(0, Math.round(durationMs)), approvals_given: 0, share_scope },
  };
}

/** Only server tool results with a product meaning raise an event; everything else is silent. */
export function toolProductEvent(
  name: string,
  input: unknown,
  output: unknown,
): ProductEvent | undefined {
  if (name === "handoff.compose")
    return { event: "handoff_created", properties: { reason_category: "assistant_request" } };
  if (name !== "form.prefill") return;
  const request = contracts["form.prefill"].input.safeParse(input);
  const result = contracts["form.prefill"].output.safeParse(output);
  if (!request.success || !result.success) return;
  return {
    event: "form_prefilled",
    properties: {
      form_id: formIdentifier(request.data.templateId),
      fields_filled: result.data.proposals.length,
      fields_missing: result.data.missingFields.length,
    },
  };
}

export function guardEvent(result: GuardedResponse): ProductEvent | undefined {
  if (result.disposition === "allow") return;
  return {
    event: "boundary_guard_triggered",
    properties: {
      layer: result.disposition === "rewrite" ? "repair" : result.reason,
      category: result.disposition,
    },
  };
}

/** Reports each non-allowed guard decision without changing what the guard returns. */
export function observeGuard(
  guard: (input: ResponseGuardInput) => Promise<GuardedResponse>,
  sink: ProductEventSink | undefined,
): (input: ResponseGuardInput) => Promise<GuardedResponse> {
  return async (input) => {
    const result = await guard(input);
    emitProductEvent(sink, guardEvent(result));
    return result;
  };
}
