import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { handleTurn, type LotseMessage, TurnError } from "@lotse/brain";
import type { BrainConfig } from "@lotse/brain/config";
import { createDocumentService, readDocumentPages } from "@lotse/brain/documents";
import { engineStateSchema, nextQuestion, processDefinitionSchema } from "@lotse/brain/engine";
import type { Database } from "@lotse/db";
import { caseActors, cases, profiles, sessions, subjects, users } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { getToolName, isToolUIPart, validateUIMessages } from "ai";
import { z } from "zod";
import { ROOT, verifiedBytes } from "../baseline/data.ts";
import { E4_CONFIG } from "../config.ts";
import type { SystemReplySchema, SystemUnderTest } from "../persona/index.ts";
import { actorRoleFor, type ScenarioInput } from "./data.ts";
import { approvedDocumentBytes } from "./documents.ts";

type Reply = z.infer<typeof SystemReplySchema>;
const chunkSchema = z.object({ type: z.string() }).passthrough();

/** Parse only public SSE evidence; raw provider errors never enter exported diagnostics. */
export function streamEvidence(sse: string): z.infer<ReturnType<typeof z.json>>[] {
  return sse.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("data: ") || line === "data: [DONE]") return [];
    const part = chunkSchema.parse(JSON.parse(line.slice(6)));
    if (part.type === "error") return [{ type: "pipeline_error" }];
    return part.type.startsWith("data-") ? [z.json().parse(part)] : [];
  });
}

export class PersistedSystemUnderTest implements SystemUnderTest {
  readonly caseId = randomUUID();
  private readonly userId = randomUUID();
  private readonly sessionId = randomUUID();
  private subjectId = "";
  private history: LotseMessage[] = [];
  private documentId: string | undefined;
  private documentDecision: boolean | undefined;
  private readonly previewId = randomUUID();
  private lifecycle: z.infer<ReturnType<typeof z.json>>[] = [];
  readonly questionBaselines: z.infer<ReturnType<typeof z.json>>[] = [];
  private readonly helper: boolean;
  private readonly storage = createObjectStorage();

  constructor(
    private readonly database: Database,
    private readonly config: BrainConfig,
    private readonly input: ScenarioInput,
  ) {
    this.helper = actorRoleFor(input) === "helper";
  }

  async startCase(options?: { signal: AbortSignal }): Promise<void> {
    options?.signal.throwIfAborted();
    this.subjectId = randomUUID();
    await this.database.db.transaction(async (tx) => {
      await tx.insert(users).values({ id: this.userId });
      await tx.insert(sessions).values({
        id: this.sessionId,
        userId: this.userId,
        clientKind: "web",
        expiresAt: new Date(Date.now() + E4_CONFIG.sessionMs),
      });
      // Do not seed undisclosed persona facts, a confirmed goal, or approvals.
      await tx.insert(profiles).values({
        userId: this.userId,
        language: this.input.persona.language,
        autonomyLevel: "L2",
      });
      await tx.insert(subjects).values({
        id: this.subjectId,
        createdBy: this.userId,
        displayName: "Synthetic evaluation subject",
        relationToUser: this.helper ? "other" : "self",
      });
      await tx
        .insert(cases)
        .values({ id: this.caseId, subjectId: this.subjectId, confirmedGoal: "" });
      await tx.insert(caseActors).values({
        caseId: this.caseId,
        userId: this.userId,
        role: this.helper ? "helper" : "subject",
        shareScope: { mode: "full" },
      });
    });
    this.lifecycle.push({
      type: "case_started",
      caseId: this.caseId,
      actorRole: this.helper ? "helper" : "subject",
    });
  }

  private pendingEvents(): z.infer<ReturnType<typeof z.json>>[] {
    const events: z.infer<ReturnType<typeof z.json>>[] = [];
    if (this.input.document && this.documentDecision === undefined && !this.helper) {
      events.push({
        type: "pending_approval",
        kind: "document_import",
        id: this.previewId,
        preview: {
          path: this.input.document.path,
          pages: this.input.interaction?.availablePages ?? [],
          subjectId: this.subjectId,
        },
        finalSubmission: false,
      });
    }
    for (const part of this.history.at(-1)?.parts ?? []) {
      if (!isToolUIPart(part)) continue;
      if (part.state === "approval-requested")
        events.push({
          type: "pending_approval",
          kind: "server_tool",
          id: part.approval.id,
          tool: getToolName(part),
          input: z.json().parse(part.input),
        });
      if (part.state === "input-available")
        events.push({
          type: "capability_unavailable",
          tool: getToolName(part),
          toolCallId: part.toolCallId,
          status: "pending",
          reason: "No native or browser capability provider is attached to this headless runner.",
        });
    }
    return events;
  }

  async sendTurn(text: string, options?: { signal: AbortSignal }): Promise<Reply> {
    const pending = this.history
      .at(-1)
      ?.parts.some(
        (part) =>
          isToolUIPart(part) && ["approval-requested", "input-available"].includes(part.state),
      );
    if (pending)
      return {
        text: "[The persisted turn awaits the pending action.]",
        events: this.pendingEvents(),
      };
    return this.execute(
      { id: randomUUID(), role: "user", parts: [{ type: "text", text }] },
      options?.signal,
    );
  }

  async decideApproval(
    id: string,
    approved: boolean,
    options?: { signal: AbortSignal },
  ): Promise<Reply> {
    options?.signal.throwIfAborted();
    if (this.helper)
      return {
        text: "[Subject approval is required; the helper cannot approve.]",
        events: [{ type: "approval_rejected", reason: "subject_required" }],
      };
    if (id === this.previewId && this.input.document && this.documentDecision === undefined) {
      this.documentDecision = approved;
      this.lifecycle.push({
        type: "document_import_decision",
        id,
        approved,
        actor: "subject",
        pages: this.input.interaction?.availablePages ?? [],
      });
      if (approved) await this.importDocument(options?.signal);
      return {
        text: approved
          ? "[Document imported after the persona's explicit preview approval. Continue the conversation.]"
          : "[Document import declined.]",
        events: [...this.lifecycle, ...this.pendingEvents()],
      };
    }
    const message = structuredClone(this.history.at(-1));
    if (!message) throw new Error("approval_not_pending");
    let found = false;
    message.parts = message.parts.map((part) => {
      if (!isToolUIPart(part) || part.state !== "approval-requested" || part.approval.id !== id)
        return part;
      found = true;
      return { ...part, state: "approval-responded", approval: { ...part.approval, approved } };
    });
    if (!found) throw new Error("approval_not_pending");
    return this.execute(message, options?.signal);
  }

  private async importDocument(signal?: AbortSignal): Promise<void> {
    const document = this.input.document;
    if (!document) return;
    const bytes = await verifiedBytes(
      resolve(ROOT, process.env.SVBOX_DIR ?? "data/svbox"),
      document.path,
      document.sha256,
    );
    const allowed =
      this.input.interaction?.availablePages ??
      Array.from({ length: document.pageCount }, (_, index) => index + 1);
    const visibleBytes = await approvedDocumentBytes(bytes, document.pageCount, allowed);
    const pages = await readDocumentPages(visibleBytes, signal);
    const result = await createDocumentService(this.database.db, this.userId, {
      storage: this.storage,
      encryptionSecret: this.config.approvalSecret,
    }).upload(visibleBytes, { subjectId: this.subjectId, type: "application/pdf", pages }, signal);
    this.documentId = result.documentId;
    this.lifecycle.push({ type: "document_imported", ...result, originalPages: allowed });
  }

  private async execute(message: LotseMessage, signal?: AbortSignal): Promise<Reply> {
    signal?.throwIfAborted();
    try {
      await this.recordQuestionBaseline();
      const response = await handleTurn(
        {
          caseId: this.caseId,
          inputKind: this.input.interaction?.channel === "voice_captions" ? "transcript" : "text",
          language: this.input.persona.language,
          capsule: {},
          actionResults: [],
        },
        message,
        { userId: this.userId, sessionId: this.sessionId, kind: "anonymous" },
        { db: this.database.db, config: this.config, ...(signal ? { abortSignal: signal } : {}) },
      );
      const events = streamEvidence(await response.text());
      const rows = await this.database
        .sql`select ui_message from message where case_id = ${this.caseId} order by position`;
      this.history = await validateUIMessages<LotseMessage>({
        messages: rows.map((row) => row.ui_message),
      });
      const last = this.history.at(-1);
      const text =
        last?.role === "assistant"
          ? last.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
          : "";
      return {
        text: text || "[No assistant text; see persisted events and pending actions.]",
        events: [...events, ...this.pendingEvents()],
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof TurnError)) throw new Error("pipeline_execution_failed");
      this.lifecycle.push({ type: "pipeline_error", code: error.code });
      return {
        text: `[Pipeline rejected the turn: ${error.code}]`,
        events: [...this.lifecycle, ...this.pendingEvents()],
      };
    }
  }

  private async recordQuestionBaseline(): Promise<void> {
    const [row] = await this.database.sql`select journey_map from "case" where id = ${this.caseId}`;
    const envelope = z.object({ process: engineStateSchema }).safeParse(row?.journey_map);
    if (!envelope.success) return;
    const [definition] = await this.database
      .sql`select record from process where key = ${envelope.data.process.processId}`;
    const parsed = processDefinitionSchema.safeParse(definition?.record);
    if (!parsed.success) return;
    const next = nextQuestion(parsed.data, structuredClone(envelope.data.process));
    this.questionBaselines.push(
      z.json().parse({
        beforeMessage: this.history.length,
        processId: parsed.data.id,
        state: envelope.data.process,
        nextSlotId: next.slotId,
        missingSlots: next.missingSlots,
      }),
    );
  }

  async evidence(): Promise<z.infer<ReturnType<typeof z.json>>> {
    const [record] = await this.database
      .sql`select confirmed_goal, status, journey_map from "case" where id = ${this.caseId}`;
    const steps = await this.database
      .sql`select process_step, status, linked_artifacts from case_step where case_id = ${this.caseId}`;
    const approvals = await this.database
      .sql`select tool_name, decision, consumed_at is not null as consumed from approval where case_id = ${this.caseId}`;
    const turns = await this.database
      .sql`select status, model_ids from turn where case_id = ${this.caseId} order by created_at`;
    return z.json().parse({
      caseId: this.caseId,
      record,
      steps: [...steps],
      approvals: [...approvals],
      turns: [...turns],
      lifecycle: this.lifecycle,
      questionBaselines: this.questionBaselines,
      tools: this.history.flatMap((message) =>
        message.parts.filter(isToolUIPart).map((part) => ({
          type: part.type,
          toolName: getToolName(part),
          toolCallId: part.toolCallId,
          state: part.state,
          input: part.input ?? null,
          output: part.state === "output-available" ? part.output : null,
          approval: part.approval
            ? {
                id: part.approval.id,
                approved: "approved" in part.approval ? part.approval.approved : null,
              }
            : null,
        })),
      ),
      capabilities: { browser: false, native: false, audio: false },
      importedDocumentId: this.documentId ?? null,
    });
  }
  close(): void {
    this.storage.close();
  }
}
