import { CaseEventSchema } from "@lotse/protocol";
import { z } from "zod";
import { CASE_API_URL, HANDOFF_NAME_MAX_LENGTH } from "./config.ts";

/** Read-only client for the case handoff, history and replay routes (FR-K3, FR-K4). */
export class CaseRecordError extends Error {
  constructor(readonly code: "CASE_BUSY" | "HANDOFF_FAILED" | "HISTORY_FAILED" | "REPLAY_FAILED") {
    super(code);
    this.name = "CaseRecordError";
  }
}

const entrySchema = z.object({
  id: z.string(),
  at: z.iso.datetime({ offset: true }),
  kind: z.string(),
  data: z.unknown(),
});
export type CaseHistoryEntry = z.infer<typeof entrySchema>;
const historySchema = z.object({ entries: z.array(entrySchema) });
const replaySchema = z.object({
  caseId: z.uuid(),
  replay: z.literal(true),
  events: z.array(entrySchema),
});
const handoffSchema = z.object({ documentKey: z.uuid() });
const subjectSchema = z.object({ subject: z.object({ displayName: z.string() }) });

const actorSchema = z.enum(["you", "subject", "helper", "unknown"]);
const decisionSchema = z.enum(["pending", "approved", "denied"]);
const eventKindSchema = CaseEventSchema.shape.kind;
export type CaseHistoryActor = z.infer<typeof actorSchema>;
export type CaseApprovalDecision = z.infer<typeof decisionSchema>;
export type CaseEventKind = z.infer<typeof eventKindSchema>;
export type ToolOutcome = "waiting" | "running" | "done" | "failed" | "declined";
export type ActionSubject =
  | { tool: string }
  | { screen: true }
  | { audit: string }
  | { event: CaseEventKind };
type Timed = { id: string; at: string };
export type TimelineItem = Timed &
  (
    | { type: "proposal"; tool: string; outcome: ToolOutcome }
    | {
        type: "approval";
        tool: string;
        decision: CaseApprovalDecision;
        actor: CaseHistoryActor;
      }
    | { type: "action"; subject: ActionSubject; failed: boolean }
    | { type: "message"; role: "user" | "assistant"; text: string }
  );
type Ranked = { rank: number; item: TimelineItem };
type TimelineContext = {
  includeMessages: boolean;
  decidedAt: ReadonlyMap<string, string>;
  gatedCalls: ReadonlySet<string>;
  proposedCalls: ReadonlySet<string>;
};

const approvalRowSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  decision: decisionSchema,
  actor: actorSchema.catch("unknown"),
});
const auditSchema = z.object({ action: z.string(), target: z.record(z.string(), z.unknown()) });
const messagePartSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  part: z.unknown(),
});
const toolPartSchema = z.object({
  toolName: z.string().optional(),
  toolCallId: z.string(),
  state: z.string(),
  approval: z.object({ id: z.string() }).optional(),
});
const textPartSchema = z.object({ text: z.string() });
const eventPartSchema = z.object({ data: z.object({ kind: eventKindSchema }) });
const actionResultSchema = z.object({ success: z.boolean() });
const outcomes: Readonly<Record<string, ToolOutcome>> = {
  "approval-requested": "waiting",
  "approval-responded": "running",
  "input-streaming": "running",
  "input-available": "running",
  "output-available": "done",
  "output-error": "failed",
  "output-denied": "declined",
};

function isToolKind(kind: string): boolean {
  return kind === "dynamic-tool" || kind.startsWith("tool-");
}

function timelineContext(
  entries: readonly CaseHistoryEntry[],
  includeMessages: boolean,
): TimelineContext {
  const decidedAt = new Map<string, string>();
  const gatedCalls = new Set<string>();
  const proposedCalls = new Set<string>();
  for (const entry of entries) {
    const row = entry.kind.startsWith("approval.") ? approvalRowSchema.safeParse(entry.data) : null;
    if (row?.success) {
      gatedCalls.add(row.data.toolCallId);
      if (entry.kind !== "approval.requested") decidedAt.set(row.data.toolCallId, entry.at);
    }
    const message = isToolKind(entry.kind) ? messagePartSchema.safeParse(entry.data) : null;
    const part = message?.success ? toolPartSchema.safeParse(message.data.part) : null;
    if (part?.success) proposedCalls.add(part.data.toolCallId);
  }
  return { includeMessages, decidedAt, gatedCalls, proposedCalls };
}

function toolItems(entry: CaseHistoryEntry, raw: unknown, context: TimelineContext): Ranked[] {
  const part = toolPartSchema.safeParse(raw);
  if (!part.success) return [];
  const { toolCallId, state, approval } = part.data;
  const tool = part.data.toolName ?? entry.kind.slice("tool-".length);
  const outcome = outcomes[state] ?? "running";
  const items: Ranked[] = [];
  if (approval || context.gatedCalls.has(toolCallId) || outcome === "waiting")
    items.push({
      rank: 0,
      item: { id: `${entry.id}:proposal`, at: entry.at, type: "proposal", tool, outcome },
    });
  if (outcome === "done" || outcome === "failed")
    items.push({
      // An approved action runs after its decision; keep it behind the approval in the list.
      rank: 1,
      item: {
        id: `${entry.id}:action`,
        at: context.decidedAt.get(toolCallId) ?? entry.at,
        type: "action",
        subject: { tool },
        failed: outcome === "failed",
      },
    });
  return items;
}

function messageItems(entry: CaseHistoryEntry, context: TimelineContext): Ranked[] {
  const message = messagePartSchema.safeParse(entry.data);
  if (!message.success) return [];
  const { role, part } = message.data;
  if (isToolKind(entry.kind)) return toolItems(entry, part, context);
  if (entry.kind === "data-case-event") {
    const event = eventPartSchema.safeParse(part);
    return event.success
      ? [
          {
            rank: 0,
            item: {
              id: entry.id,
              at: entry.at,
              type: "action",
              subject: { event: event.data.data.kind },
              failed: false,
            },
          },
        ]
      : [];
  }
  const text = entry.kind === "text" ? textPartSchema.safeParse(part) : null;
  if (!context.includeMessages || role === "system" || !text?.success || !text.data.text.trim())
    return [];
  return [
    {
      rank: 0,
      item: { id: entry.id, at: entry.at, type: "message", role, text: text.data.text.trim() },
    },
  ];
}

function approvalItems(entry: CaseHistoryEntry, context: TimelineContext): Ranked[] {
  // Audit rows repeat approval decisions without the tool; the approval table entry is shown.
  const row = approvalRowSchema.safeParse(entry.data);
  if (!row.success) return [];
  const { toolCallId, toolName, decision, actor } = row.data;
  const requested = entry.kind === "approval.requested";
  if (requested && (context.decidedAt.has(toolCallId) || context.proposedCalls.has(toolCallId)))
    return [];
  return [
    {
      rank: 0,
      item: {
        id: entry.id,
        at: entry.at,
        type: "approval",
        tool: toolName,
        decision: requested ? "pending" : decision,
        actor,
      },
    },
  ];
}

function entryItems(entry: CaseHistoryEntry, context: TimelineContext): Ranked[] {
  if (entry.kind.startsWith("approval.")) return approvalItems(entry, context);
  if (entry.kind === "action.result") {
    const result = actionResultSchema.safeParse(entry.data);
    return result.success
      ? [
          {
            rank: 0,
            item: {
              id: entry.id,
              at: entry.at,
              type: "action",
              subject: { screen: true },
              failed: !result.data.success,
            },
          },
        ]
      : [];
  }
  const audit = auditSchema.safeParse(entry.data);
  if (audit.success)
    return [
      {
        rank: 0,
        item: {
          id: entry.id,
          at: entry.at,
          type: "action",
          subject: { audit: audit.data.action },
          failed: false,
        },
      },
    ];
  return messageItems(entry, context);
}

/** Orders proposals, approvals and actions; conversation text is included only for a replay. */
export function buildTimeline(
  entries: readonly CaseHistoryEntry[],
  includeMessages = false,
): TimelineItem[] {
  const context = timelineContext(entries, includeMessages);
  return entries
    .flatMap((entry) => entryItems(entry, context))
    .sort((a, b) => Date.parse(a.item.at) - Date.parse(b.item.at) || a.rank - b.rank)
    .map(({ item }) => item);
}

const readInit: RequestInit = { credentials: "same-origin", cache: "no-store" };
function caseUrl(caseId: string, path = ""): string {
  return `${CASE_API_URL}/${encodeURIComponent(z.uuid().parse(caseId))}${path}`;
}

export async function loadCaseHistory(
  caseId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TimelineItem[]> {
  const response = await fetcher(caseUrl(caseId, "/history"), { ...readInit, signal });
  if (!response.ok) throw new CaseRecordError("HISTORY_FAILED");
  const parsed = historySchema.safeParse(await response.json());
  if (!parsed.success) throw new CaseRecordError("HISTORY_FAILED");
  return buildTimeline(parsed.data.entries);
}

export async function loadCaseReplay(
  caseId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TimelineItem[]> {
  const response = await fetcher(caseUrl(caseId, "/replay"), { ...readInit, signal });
  if (!response.ok) throw new CaseRecordError("REPLAY_FAILED");
  const parsed = replaySchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.caseId !== caseId) throw new CaseRecordError("REPLAY_FAILED");
  return buildTimeline(parsed.data.events, true);
}

function isPdf(response: Response): boolean {
  return response.headers.get("content-type")?.split(";")[0]?.trim() === "application/pdf";
}

async function pdfBlob(response: Response): Promise<Blob> {
  return new Blob([await response.arrayBuffer()], { type: "application/pdf" });
}

/** Composes the summary on the server and returns the PDF; the route may answer with it directly. */
export async function prepareHandoff(caseId: string, fetcher: typeof fetch = fetch): Promise<Blob> {
  const url = caseUrl(caseId, "/handoff");
  const response = await fetcher(url, {
    ...readInit,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (response.status === 409) throw new CaseRecordError("CASE_BUSY");
  if (!response.ok) throw new CaseRecordError("HANDOFF_FAILED");
  if (isPdf(response)) return pdfBlob(response);
  const result = handoffSchema.safeParse(await response.json());
  if (!result.success) throw new CaseRecordError("HANDOFF_FAILED");
  // The download URL is rebuilt from the validated key, never taken from the response.
  const file = await fetcher(`${url}?${new URLSearchParams(result.data)}`, readInit);
  if (!file.ok || !isPdf(file)) throw new CaseRecordError("HANDOFF_FAILED");
  return pdfBlob(file);
}

export async function loadSubjectName(
  caseId: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetcher(caseUrl(caseId), readInit);
  if (!response.ok) return null;
  const parsed = subjectSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.subject.displayName : null;
}

export function handoffFileName(prefix: string, subjectName: string | null): string {
  const name = (subjectName ?? "")
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HANDOFF_NAME_MAX_LENGTH)
    .trim();
  return `${name ? `${prefix} ${name}` : prefix}.pdf`;
}
