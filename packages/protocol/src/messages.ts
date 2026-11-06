import { z } from "zod";
import {
  BoundingBoxSchema,
  CapabilitiesSchema,
  FactSourceSchema,
  IdSchema,
  IndexSchema,
  JsonObjectSchema,
  JsonValueSchema,
  LanguageTagSchema,
  PROTOCOL_VERSION,
  ProvenanceSchema,
  SemverSchema,
  UnitIntervalSchema,
  UriSchema,
  WindowRectSchema,
} from "./shared.ts";
import { TargetSchema } from "./target.ts";

export const BridgeHelloSchema = z.strictObject({
  appVersion: SemverSchema,
  protocolVersion: z.literal(PROTOCOL_VERSION),
  capabilities: CapabilitiesSchema,
});
export type BridgeHello = z.infer<typeof BridgeHelloSchema>;
export const ClientHelloSchema = z.strictObject({
  clientKind: z.enum(["web", "mac", "helper"]),
  appVersion: SemverSchema,
  protocolVersion: z.literal(PROTOCOL_VERSION),
  capabilities: CapabilitiesSchema,
  locale: LanguageTagSchema,
});
export type ClientHello = z.infer<typeof ClientHelloSchema>;

export const ContextCapsuleSchema = z.strictObject({
  screen: z
    .strictObject({
      screenIndex: IndexSchema,
      summary: z.string(),
      ocrLines: z.array(z.strictObject({ text: z.string(), bbox: BoundingBoxSchema })),
      // Reference to the downscaled image's accompanying UI message file part.
      image: IdSchema.optional(),
    })
    .optional(),
  page: z
    .strictObject({
      url: UriSchema,
      handles: z.array(
        z.strictObject({
          id: IdSchema,
          role: z.string(),
          label: z.string(),
          value: z.string(),
          bbox: BoundingBoxSchema,
        }),
      ),
    })
    .optional(),
  focusedRegion: BoundingBoxSchema.optional(),
});
export type ContextCapsule = z.infer<typeof ContextCapsuleSchema>;
export const TranscriptSchema = z.strictObject({
  text: z.string(),
  language: LanguageTagSchema.optional(),
  final: z.boolean(),
  capsule: ContextCapsuleSchema.optional(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const ActionResultSchema = z.strictObject({
  actionId: IdSchema,
  resolvedBy: z.enum(["ui", "dom", "ax", "ocr", "vision"]),
  confidence: UnitIntervalSchema,
  success: z.boolean(),
  failureReason: z.string().optional(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;
export const TurnRequestSchema = z.strictObject({
  caseId: IdSchema.optional(),
  subjectId: IdSchema.optional(),
  inputKind: z.enum(["transcript", "text"]),
  language: LanguageTagSchema.optional(),
  capsule: ContextCapsuleSchema,
  actionResults: z.array(ActionResultSchema),
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;
export const SpeechSegmentSchema = z.strictObject({
  turnId: IdSchema,
  index: IndexSchema,
  text: z.string(),
  language: LanguageTagSchema,
  citations: z.array(z.strictObject({ passageId: IdSchema, url: UriSchema, quote: z.string() })),
  actionIds: z.array(IdSchema),
});
export type SpeechSegment = z.infer<typeof SpeechSegmentSchema>;

const DisplayPayloadSchema = z.strictObject({
  label: z.string().optional(),
  style: z.string().optional(),
});
export const TypePayloadSchema = z.strictObject({
  value: z.string(),
  provenance: ProvenanceSchema,
  // Milliseconds between keystrokes; a positive pace keeps filling visible.
  pace: z.number().positive(),
});
export type TypePayload = z.infer<typeof TypePayloadSchema>;
const actionFields = { id: IdSchema, target: TargetSchema, sentenceIndex: IndexSchema };
export const ActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...actionFields, kind: z.literal("point"), payload: DisplayPayloadSchema }),
  z.strictObject({ ...actionFields, kind: z.literal("highlight"), payload: DisplayPayloadSchema }),
  z.strictObject({ ...actionFields, kind: z.literal("annotate"), payload: DisplayPayloadSchema }),
  z.strictObject({ ...actionFields, kind: z.literal("caption"), payload: DisplayPayloadSchema }),
  z.strictObject({
    ...actionFields,
    kind: z.literal("openResource"),
    payload: DisplayPayloadSchema,
  }),
  z.strictObject({ ...actionFields, kind: z.literal("type"), payload: TypePayloadSchema }),
  z.strictObject({ ...actionFields, kind: z.literal("clear"), payload: DisplayPayloadSchema }),
]);
export type Action = z.infer<typeof ActionSchema>;
export const TargetRectSchema = z.strictObject({
  targetId: IdSchema,
  rect: WindowRectSchema,
  scale: z.number().positive(),
  visible: z.boolean(),
});
export type TargetRect = z.infer<typeof TargetRectSchema>;
export const ToolInvocationSchema = z.strictObject({
  toolCallId: IdSchema,
  toolName: z.enum([
    "ui.fill",
    "context.readScreen",
    "calendar.createEvent",
    "session.shareWithHelper",
  ]),
  input: JsonObjectSchema,
});
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;
export const ToolOutputSchema = z.strictObject({
  toolCallId: IdSchema,
  output: z.union([ActionResultSchema, ContextCapsuleSchema]),
  error: z.string().optional(),
});
export type ToolOutput = z.infer<typeof ToolOutputSchema>;
export const ApprovalContextSchema = z.strictObject({
  approvalId: IdSchema,
  caseId: IdSchema,
  toolCallId: IdSchema,
  toolName: z.string().min(1),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.array(ProvenanceSchema),
  summary: z.string(),
});
export type ApprovalContext = z.infer<typeof ApprovalContextSchema>;
export const ApprovalDecisionSchema = z.strictObject({
  approvalId: IdSchema,
  approved: z.boolean(),
  reason: z.string().optional(),
  via: z.enum(["voice", "key", "click"]),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export const SpeechControlSchema = z.strictObject({
  stop: z.boolean(),
  state: z.enum(["speaking", "idle"]),
  segmentIndex: IndexSchema,
});
export type SpeechControl = z.infer<typeof SpeechControlSchema>;
export const FactSchema = z.strictObject({
  id: IdSchema,
  subjectId: IdSchema,
  type: z.string().min(1),
  value: JsonValueSchema,
  source: FactSourceSchema,
  confidence: UnitIntervalSchema,
  confirmed: z.boolean(),
});
export type Fact = z.infer<typeof FactSchema>;
export const CaseEventSchema = z.strictObject({
  caseId: IdSchema,
  kind: z.enum([
    "goal_confirmed",
    "step_created",
    "step_completed",
    "reminder_created",
    "artefact_ready",
  ]),
  payload: JsonObjectSchema,
});
export type CaseEvent = z.infer<typeof CaseEventSchema>;
export const JobProgressSchema = z.strictObject({
  jobId: IdSchema,
  state: z.string().min(1),
  progress: UnitIntervalSchema,
  message: z.string(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;
export const SafetyNoticeSchema = z.strictObject({
  text: z.string(),
  numbers: z.array(z.strictObject({ label: z.string(), number: z.string().min(1) })),
  scopeAfter: z.literal("administrative_only"),
});
export type SafetyNotice = z.infer<typeof SafetyNoticeSchema>;

export const MESSAGE_SCHEMAS = {
  BridgeHello: BridgeHelloSchema,
  ClientHello: ClientHelloSchema,
  Transcript: TranscriptSchema,
  TurnRequest: TurnRequestSchema,
  ContextCapsule: ContextCapsuleSchema,
  SpeechSegment: SpeechSegmentSchema,
  Action: ActionSchema,
  ToolInvocation: ToolInvocationSchema,
  ToolOutput: ToolOutputSchema,
  ApprovalContext: ApprovalContextSchema,
  ApprovalDecision: ApprovalDecisionSchema,
  ActionResult: ActionResultSchema,
  SpeechControl: SpeechControlSchema,
  TargetRect: TargetRectSchema,
  Fact: FactSchema,
  CaseEvent: CaseEventSchema,
  JobProgress: JobProgressSchema,
  SafetyNotice: SafetyNoticeSchema,
} as const;

/** A fixed, claim-free progress line streamed while a slow tool step runs (never persisted). */
export const StatusLineSchema = z.strictObject({
  turnId: IdSchema,
  text: z.string().max(120),
});
export type StatusLine = z.infer<typeof StatusLineSchema>;

export const DATA_PARTS = {
  status: StatusLineSchema,
  "speech-segment": SpeechSegmentSchema,
  action: ActionSchema,
  "case-event": CaseEventSchema,
  "safety-notice": SafetyNoticeSchema,
  "job-progress": JobProgressSchema,
  "approval-context": ApprovalContextSchema,
} as const;
export type LotseDataParts = {
  [Name in keyof typeof DATA_PARTS]: z.infer<(typeof DATA_PARTS)[Name]>;
};
