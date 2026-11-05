import { z } from "zod";
import {
  ActionResultSchema,
  ActionSchema,
  ApprovalContextSchema,
  ApprovalDecisionSchema,
  BridgeHelloSchema,
  JobProgressSchema,
  SafetyNoticeSchema,
  SpeechControlSchema,
  SpeechSegmentSchema,
  TargetRectSchema,
  ToolInvocationSchema,
  ToolOutputSchema,
  TranscriptSchema,
} from "./messages.ts";
import { IdSchema, PROTOCOL_VERSION } from "./shared.ts";

function envelope<const Name extends string, Payload extends z.ZodType>(
  type: Name,
  payload: Payload,
) {
  return z.strictObject({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal(type),
    id: IdSchema,
    payload,
  });
}

export const BridgeToWorkspaceSchema = z.discriminatedUnion("type", [
  envelope("BridgeHello", BridgeHelloSchema),
  envelope("Transcript", TranscriptSchema),
  envelope("ToolOutput", ToolOutputSchema),
  envelope("ApprovalDecision", ApprovalDecisionSchema),
  envelope("ActionResult", ActionResultSchema),
  envelope("SpeechControl", SpeechControlSchema),
]);
export type BridgeToWorkspace = z.infer<typeof BridgeToWorkspaceSchema>;
export const BridgeToNativeSchema = z.discriminatedUnion("type", [
  envelope("SpeechSegment", SpeechSegmentSchema),
  envelope("Action", ActionSchema),
  envelope("TargetRect", TargetRectSchema),
  envelope("ToolInvocation", ToolInvocationSchema),
  envelope("ApprovalContext", ApprovalContextSchema),
  envelope("JobProgress", JobProgressSchema),
  envelope("SafetyNotice", SafetyNoticeSchema),
  envelope("SpeechControl", SpeechControlSchema),
]);
export type BridgeToNative = z.infer<typeof BridgeToNativeSchema>;
