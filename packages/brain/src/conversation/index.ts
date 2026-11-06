import { randomUUID } from "node:crypto";
import { createDatabase, type DatabaseClient } from "@lotse/db";
import { jobs, messages, turns } from "@lotse/db/schema";
import { detectTurnControl } from "@lotse/knowledge/turn-controls";
import {
  ActionSchema,
  ClientHelloSchema,
  DATA_PARTS,
  type SpeechSegment,
  type TurnRequest,
  TurnRequestSchema,
} from "@lotse/protocol";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  type LanguageModel,
  type UIMessageChunk,
  validateUIMessages,
} from "ai";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createLotseAgent } from "../agent/index.ts";
import { DRAFTLESS_TOOLS, irrelevantToolNames } from "../agent/relevance.ts";
import { canonicalJson } from "../approvals/canonical.ts";
import { createApprovalService } from "../approvals/index.ts";
import { type BrainConfig, PIPELINE_CONFIG, parseBrainConfig } from "../config/index.ts";
import { GUARD_CONFIG } from "../guards/config.ts";
import {
  createGuardedDataWriter,
  createResponseGuard,
  createSupportVerifier,
  detectSafetyNet,
  extractCitedClaims,
  guardCopy,
  guardLocale,
  memoizeSupportVerifier,
  type RetrievedPassage,
} from "../guards/index.ts";
import { jobProgress } from "../jobs/progress.ts";
import { communicationInstructions } from "../language/copy.ts";
import {
  detectCommunicationPreferences,
  mayChangePreferences,
  preferencePatch,
  replySettings,
} from "../language/detect.ts";
import { DEFAULT_PROFILE_SETTINGS, updateProfileSettings } from "../language/settings.ts";
import { createModelRouter } from "../models/index.ts";
import {
  type ComposerSource,
  composeAnswer,
  dropUnsupportedSentences,
  toolSources,
  topSources,
} from "../pipeline/compose.ts";
import { handleTurnControl } from "../pipeline/controls.ts";
import { preparePipeline } from "../pipeline/index.ts";
import { createSegmentWriter } from "../pipeline/segment.ts";
import { createStatusAnnouncer, statusPart } from "../pipeline/status-copy.ts";
import type { Passage } from "../retrieval/index.ts";
import { effectiveShareScope } from "../subjects/access.ts";
import { startTurnTelemetry, type TurnMetrics, type TurnTelemetry } from "../telemetry/index.ts";
import {
  emitProductEvent,
  heldUntilCommit,
  observeGuard,
  type ProductEventSink,
} from "../telemetry/product-events.ts";
import { contracts, isToolName } from "../tools/contracts/index.ts";
import {
  AFTER_OPEN_POLICY,
  answersOffer,
  guidanceOffer,
  offerChunks,
  openedResource,
  recentUserTexts,
} from "../tools/impl/ui/resource.ts";
import type { LotseMessage } from "../tools/types.ts";
import { pointedToolCall, resultPointAction } from "../workspace/targets.ts";
import { approvedResultCheckpoint } from "./approved-results.ts";
import { TurnError, turnStreamError } from "./errors.ts";
import {
  hasOpenToolCall,
  loadMessages,
  mergeLatest,
  saveMessages,
  validateLatest,
} from "./history.ts";
import { recoverConsumedCalls } from "./recovery.ts";
import { claimTurn, lockTurnClaim, resolveContext, type SessionIdentity } from "./store.ts";

const bodySchema = TurnRequestSchema.extend({
  clientHello: ClientHelloSchema.optional(),
  message: z.unknown().optional(),
  messages: z.array(z.unknown()).optional(),
});

export function parseTurnBody(raw: unknown) {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new TurnError("INVALID_TURN", 400);
  const { message, messages: clientMessages, clientHello: _hello, ...turn } = parsed.data;
  return { turn, latestMessage: message ?? clientMessages?.at(-1) };
}

let defaultDatabase: ReturnType<typeof createDatabase> | undefined;
let defaultConfig: BrainConfig | undefined;

export async function closeBrain() {
  await defaultDatabase?.close();
  defaultDatabase = undefined;
  defaultConfig = undefined;
}

function defaults() {
  defaultConfig ??= parseBrainConfig();
  defaultDatabase ??= createDatabase();
  return { db: defaultDatabase.db, config: defaultConfig };
}

function checkpoints() {
  let completed = 0;
  let failure: unknown;
  const waits = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>();
  return {
    wait: (step: number) => {
      if (failure) return Promise.reject(failure);
      if (step <= completed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waits.set(step, { resolve, reject });
      });
    },
    complete: () => {
      completed++;
      waits.get(completed)?.resolve();
      waits.delete(completed);
    },
    fail: (error: unknown) => {
      failure = error;
      for (const wait of waits.values()) wait.reject(error);
      waits.clear();
    },
  };
}

/** Reason codes and durations only, one line per turn, so the critical path is visible in logs. */
function logTurnTimings(status: string, timings: Record<string, number>, metrics: TurnMetrics) {
  const rounded = (values: Record<string, number>) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Math.round(value)]));
  console.info(
    JSON.stringify({
      event: "turn_timings",
      status,
      ...rounded(timings),
      stages: rounded(metrics.stageLatencies),
      modelCalls: metrics.modelCalls,
      modelMs: Math.round(metrics.modelMs),
      toolMs: Math.round(metrics.toolMs),
      latencyMs: Math.round(metrics.latencyMs),
    }),
  );
}

async function runTurn(
  request: TurnRequest,
  latestMessage: unknown,
  session: SessionIdentity,
  telemetry: TurnTelemetry,
  options?: {
    db?: DatabaseClient;
    config?: BrainConfig;
    model?: LanguageModel;
    languageModel?: LanguageModel;
    abortSignal?: AbortSignal;
    onTurnComplete?: (metrics: TurnMetrics) => Promise<void>;
    onProductEvent?: ProductEventSink;
  },
): Promise<Response> {
  const runtime =
    options?.db && options.config ? { db: options.db, config: options.config } : defaults();
  const db = options?.db ?? runtime.db;
  const config = options?.config ?? runtime.config;
  const parsed = TurnRequestSchema.parse(request);
  const latest = await validateLatest(latestMessage);
  const language = parsed.language;
  const latestUser = latest.role === "user" ? latest : undefined;
  const userText =
    latestUser?.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? "";
  const safety = detectSafetyNet({
    text: userText,
    source: "user",
    ...(language ? { language } : {}),
  });
  // Approval decisions are recorded inside the context transaction; report them only after commit.
  const productEvents = heldUntilCommit(options?.onProductEvent);
  const approvalService = createApprovalService(db, config.approvalSecret, productEvents.sink);
  const prepared = await telemetry.stage("context", () =>
    db.transaction(async (tx) => {
      const context = await resolveContext(tx, parsed, session);
      // History can repeat private facts in prose as well as tool results. Until
      // it has a provenance-aware projection, restricted helpers cannot read it.
      if (context.actorRole === "helper") {
        const scope = effectiveShareScope(context.shareScope);
        if (scope.facts !== true || scope.documents !== true)
          throw new TurnError("CASE_ACCESS_DENIED", 403);
      }
      const { turnId, recover } = await claimTurn(tx, context, parsed);
      const stored = await loadMessages(tx, context.caseId);
      const history = recover ? await recoverConsumedCalls(tx, context.caseId, stored) : stored;
      // A safety notice may interrupt a pending approval without consuming or dispatching it.
      // Continue the server-owned assistant message so its approval parts remain actionable.
      const pending = hasOpenToolCall(history.at(-1));
      const merged =
        (safety || detectTurnControl(userText)?.kind === "pause") &&
        pending &&
        !history.some((message) => message.id === latest.id)
          ? { history, dispatch: [] as string[] }
          : await mergeLatest(tx, history, latest, context, approvalService);
      await saveMessages(tx, context.caseId, merged.history);
      const safetyDelivered = history.some((message) =>
        message.parts.some((part) => part.type === "data-safety-notice" && part.id === latest.id),
      );
      const caseJobs = await tx.select().from(jobs).where(eq(jobs.caseId, context.caseId));
      const [cost] = await tx
        .select({
          complete: sql<boolean>`coalesce(bool_and(case when ${turns.id} = ${turnId} then true else coalesce(${turns.timings}->'costComplete' = 'true'::jsonb, false) end), true)`,
          usd: sql<string>`coalesce(sum(case when jsonb_typeof(${turns.timings}->'costUsd') = 'number' then (${turns.timings}->>'costUsd')::numeric else 0 end), 0)`,
        })
        .from(turns)
        .where(eq(turns.caseId, context.caseId));
      return {
        ...merged,
        context,
        turnId,
        safetyDelivered,
        jobProgress: caseJobs.map((job) =>
          jobProgress(job, parsed.language?.startsWith("en") ? "en" : "de"),
        ),
        caseCostUsd: Number(cost?.usd ?? 0),
        caseCostComplete: cost?.complete ?? false,
      };
    }),
  );
  productEvents.commit();
  telemetry.identify(prepared.context.caseId, prepared.turnId);
  const overBudget = telemetry.caseBudget(
    prepared.caseCostUsd,
    config.caseBudgetUsd,
    prepared.caseCostComplete,
  );
  const fallback = config.models.orchestrator.fallback;
  const turnConfig =
    overBudget && fallback
      ? {
          ...config,
          models: { ...config.models, orchestrator: { primary: fallback, fallback: undefined } },
        }
      : config;
  const checkpoint = checkpoints();
  const timings: Record<string, number> = {};
  const pipelineStarted = performance.now();
  const speechSegments: SpeechSegment[] = [];
  const cancellation = new AbortController();
  let failed = false;
  const save = async (
    history: LotseMessage[],
    status?: "completed" | "awaiting_approval" | "failed" | "interrupted",
  ) => {
    try {
      const normalized = await validateUIMessages<LotseMessage>({
        messages: prepared.dispatch.length > 0 ? prepared.history : history,
        dataSchemas: DATA_PARTS,
      });
      await db.transaction(async (tx) => {
        await lockTurnClaim(tx, prepared.context.caseId, prepared.turnId);
        await saveMessages(tx, prepared.context.caseId, normalized);
        const rows = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.caseId, prepared.context.caseId))
          .orderBy(messages.position);
        await tx
          .update(turns)
          .set({
            messageIds: rows.map((row) => row.id),
            timings: { ...telemetry.snapshot(), ...timings },
            modelIds: { used: telemetry.modelIds() },
            segments: speechSegments.map((segment) => z.json().parse(segment)),
            ...(status ? { status } : {}),
          })
          .where(eq(turns.id, prepared.turnId));
      });
    } catch (error) {
      checkpoint.fail(error);
      throw error;
    }
  };
  const stream = createUIMessageStream<LotseMessage>({
    originalMessages: prepared.history,
    generateId: randomUUID,
    onError: (error) => {
      failed = true;
      checkpoint.fail(error);
      return turnStreamError(error);
    },
    onStepEnd: async ({ messages: history }) => {
      await save(history);
      checkpoint.complete();
    },
    onEnd: async ({ messages: history, isAborted, isCancelled }) => {
      if (isAborted || isCancelled) cancellation.abort();
      let awaiting = false;
      const outcome = (): "completed" | "awaiting_approval" | "failed" | "interrupted" =>
        failed
          ? "failed"
          : isAborted || isCancelled
            ? "interrupted"
            : awaiting
              ? "awaiting_approval"
              : "completed";
      try {
        awaiting = hasOpenToolCall(history.at(-1));
        await save(history, outcome());
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        telemetry.end(outcome());
        logTurnTimings(outcome(), timings, telemetry.snapshot());
        if (!failed && !isAborted && !isCancelled) {
          try {
            await options?.onTurnComplete?.(telemetry.snapshot());
          } catch {
            /* Export is best effort. */
          }
        }
        checkpoint.fail(new Error("Turn stream ended"));
      }
    },
    execute: async ({ writer }) => {
      // SDK client tools deliberately have no execute. After the authoritative
      // transaction consumes approval, re-emit just those calls to onToolCall.
      // Wait for addToolOutput before asking the model for the next step.
      writer.write({ type: "start" });
      for (const data of prepared.jobProgress)
        writer.write({ type: "data-job-progress", id: data.jobId, data });
      if (prepared.dispatch.length > 0) {
        const last = prepared.history.at(-1);
        for (const part of last?.parts ?? []) {
          if (isToolUIPart(part) && prepared.dispatch.includes(part.toolCallId)) {
            const toolName = getToolName(part);
            if (!isToolName(toolName)) throw new TurnError("INVALID_TURN", 400);
            telemetry.dispatchTool(toolName, part.toolCallId, () =>
              writer.write({
                type: "tool-input-available",
                toolCallId: part.toolCallId,
                toolName,
                input: part.input,
              }),
            );
          }
        }
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish" });
        return;
      }
      timings.safetyMs = performance.now() - pipelineStarted;
      if (safety) {
        if (!prepared.safetyDelivered) {
          writer.write({ type: "data-safety-notice", id: latest.id, data: safety.notice });
          emitProductEvent(productEvents.sink, {
            event: "safety_net_triggered",
            properties: { pattern_category: safety.category },
          });
        }
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish" });
        return;
      }
      const control = await handleTurnControl({
        db,
        context: prepared.context,
        latest,
        history: prepared.history,
        ...(parsed.language ? { language: parsed.language } : {}),
      });
      if (control) {
        if (control.metadata)
          writer.write({ type: "message-metadata", messageMetadata: control.metadata });
        const output = createSegmentWriter({
          writer,
          context: prepared.context,
          turnId: prepared.turnId,
          language: control.language,
          config,
          passages: new Map(),
        });
        output.emit(randomUUID(), control.reply);
        speechSegments.push(...output.segments);
        timings.totalMs = performance.now() - pipelineStarted;
        writer.write({ type: "finish" });
        return;
      }
      const utterance =
        prepared.history
          .findLast((message) => message.role === "user")
          ?.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n") ?? "";
      const stored = prepared.context.profileSettings ?? { ...DEFAULT_PROFILE_SETTINGS };
      // Preference detection and the pipeline (classification, retrieval) run concurrently.
      const detectSettings = async () => {
        let settings = stored;
        if (
          latest.role === "user" &&
          utterance.trim() &&
          mayChangePreferences(utterance, stored.language)
        ) {
          const detection = await detectCommunicationPreferences(
            utterance,
            options?.languageModel ??
              options?.model ??
              createModelRouter(config).modelFor("classifier"),
            options?.abortSignal,
          );
          const patch = preferencePatch(detection);
          if (
            patch &&
            Object.entries(patch).some(
              ([key, value]) => settings[key as keyof typeof settings] !== value,
            )
          )
            settings = await updateProfileSettings(db, session.userId, patch);
          settings = replySettings(settings, detection);
        }
        return settings;
      };
      const passages = new Map<string, Passage>();
      const onSpeech = (): void => {
        timings.firstSegmentMs ??= performance.now() - pipelineStarted;
      };
      const onGuard = (durationMs: number): void => {
        timings.guardMs = (timings.guardMs ?? 0) + durationMs;
      };
      const onAnswerGuard = (durationMs: number): void => {
        timings.answerGuardMs ??= durationMs;
        timings.answerGuardDoneAtMs ??= performance.now() - pipelineStarted;
      };
      const administrativeOnly = prepared.history.some((message) =>
        message.parts.some((part) => part.type === "data-safety-notice"),
      );
      // One verifier per turn: the early sentence check and the response guard share verdicts.
      const supports = memoizeSupportVerifier(createSupportVerifier(config));
      // A withheld answer is recomposed from the same evidence, so its citations survive.
      let recompose: ((text: string) => Promise<string | undefined>) | undefined;
      const responseGuard = createResponseGuard(config, {
        supports,
        repair: async (input) => recompose?.(input.text),
      });
      responseGuard.prewarm(userText, options?.abortSignal);
      const guard = observeGuard(responseGuard, productEvents.sink);
      const guardPassages: RetrievedPassage[] = [];
      const [settings, pipeline] = await Promise.all([
        detectSettings(),
        preparePipeline({
          db,
          config,
          context: prepared.context,
          turnId: prepared.turnId,
          request: {
            ...parsed,
            language: stored.language === "de" ? "de-AT" : "en",
          },
          timings,
          history: prepared.history,
          ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
        }),
      ]);
      prepared.context.profileSettings = settings;
      const language = settings.language === "de" ? "de-AT" : "en";
      timings.contextReadyMs = performance.now() - pipelineStarted;
      const output = createSegmentWriter({
        writer,
        context: prepared.context,
        turnId: prepared.turnId,
        language,
        config,
        passages,
        onSpeech,
        onGuard,
        onAnswerGuard,
        ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
      });
      const guardContext = {
        userText,
        language,
        signal: options?.abortSignal,
        administrativeOnly,
        passages: guardPassages,
      };
      // The agent's prose is a draft. Only its final step can become the answer, which is
      // recomposed from this turn's evidence (or, for approval turns, guarded as written).
      const draft = { id: undefined as string | undefined, text: "" };
      const acceptDraft = (part: UIMessageChunk): boolean => {
        if (part.type === "start-step") {
          draft.id = undefined;
          draft.text = "";
          return false;
        }
        if (
          part.type === "reasoning-start" ||
          part.type === "reasoning-delta" ||
          part.type === "reasoning-end"
        )
          return true;
        if (part.type === "text-start") {
          draft.id ??= part.id;
          return true;
        }
        if (part.type === "text-delta") {
          draft.id ??= part.id;
          if (draft.text.length + part.delta.length <= GUARD_CONFIG.maxResponseCharacters)
            draft.text += part.delta;
          return true;
        }
        return part.type === "text-end";
      };
      // Sourced results of earlier turns (catalog, offices, knowledge) stay citable in follow-ups.
      const toolEvidence: ComposerSource[] = prepared.history.flatMap((message) =>
        message.parts.flatMap((part) => {
          if (!isToolUIPart(part) || part.state !== "output-available") return [];
          if (getToolName(part) === "kb.search") {
            const retrieved = contracts["kb.search"].output.safeParse(part.output);
            return retrieved.success
              ? retrieved.data.map(({ id, text, url, validFrom }) => ({ id, text, url, validFrom }))
              : [];
          }
          return toolSources(part.toolCallId, part.output);
        }),
      );
      const searchEvidence: ComposerSource[] = [];
      const inputs = new Map<string, { toolName: string; input: unknown }>();
      const previousAnswer = prepared.history
        .findLast((message) => message.role === "assistant")
        ?.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join(" ")
        .slice(-600);
      let approvalRequested = false;
      const responseChecks = new Map<string, ReturnType<typeof guard>>();
      const guardText = (text: string): ReturnType<typeof guard> => {
        let checked = responseChecks.get(text);
        if (!checked) {
          const started = performance.now();
          checked = guard({
            ...guardContext,
            text,
            claims: extractCitedClaims(text, guardPassages),
          });
          responseChecks.set(text, checked);
          checked.then(
            () => {
              timings.responseGuardMs ??= performance.now() - started;
              timings.responseGuardDoneAtMs ??= performance.now() - pipelineStarted;
            },
            () => responseChecks.delete(text),
          );
        }
        return checked;
      };
      // Both release gates start as soon as a candidate exists; `finish` reuses their verdicts.
      const prefetchGuards = (text: string): void => {
        if (!text.trim()) return;
        output.prefetch(text);
        guardText(text).catch(() => {});
      };
      const writeAnswer = async (id: string, text: string): Promise<void> => {
        await output.write({ type: "text-start", id });
        await output.write({ type: "text-delta", id, delta: text });
        await output.write({ type: "text-end", id });
      };
      const compose = async (withDraft: boolean, offerGoal?: string, retry = false) => {
        const started = performance.now();
        const sources = [
          ...toolEvidence,
          ...searchEvidence,
          ...(pipeline.confirmed ? pipeline.passages : []).map(({ id, text, url }) => ({
            id,
            text,
            url,
          })),
        ].filter(
          (source, index, all) => all.findIndex((other) => other.id === source.id) === index,
        );
        const composed = await composeAnswer({
          model:
            options?.languageModel ??
            options?.model ??
            createModelRouter(config).modelFor("extractor"),
          userText,
          language,
          sources,
          ...(withDraft ? { draft: draft.text } : {}),
          ...(pipeline.confirmed
            ? { facts: pipeline.blocks.facts, caseContext: pipeline.blocks.case }
            : {}),
          communication: communicationInstructions(settings),
          administrativeOnly,
          ...(offerGoal ? { offerGoal } : {}),
          ...(retry ? { retry } : {}),
          ...(previousAnswer ? { previousAnswer } : {}),
          ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
        });
        const ms = performance.now() - started;
        if (!withDraft) timings.speculativeComposeMs ??= ms;
        console.info(
          JSON.stringify({
            event: "answer_composed",
            speculative: !withDraft,
            sources: sources.length,
            cited: composed.cited,
            dropped: composed.dropped,
            ms: Math.round(ms),
          }),
        );
        // Only cited tool sources join the evidence the guards see; retrieved passages already do.
        for (const source of toolEvidence) {
          if (!composed.text.includes(`[passage:${source.id}]`) || passages.has(source.id))
            continue;
          passages.set(source.id, {
            id: source.id,
            text: source.text,
            url: source.url,
            validFrom: source.validFrom ?? new Date().toISOString().slice(0, 10),
            validTo: null,
          });
          guardPassages.push({ id: source.id, text: source.text, url: source.url });
        }
        // The guards check the candidate while its sentences are verified; a sentence removal
        // only re-runs them for the shortened text.
        if (!retry) prefetchGuards(composed.text);
        const checkStarted = performance.now();
        const checked = await dropUnsupportedSentences(
          composed.text,
          guardPassages,
          supports,
          language,
          options?.abortSignal,
        );
        timings.citationCheckMs ??= performance.now() - checkStarted;
        if (checked.removed > 0) {
          console.info(
            JSON.stringify({ event: "answer_sentences_removed", removed: checked.removed }),
          );
          if (!retry) prefetchGuards(checked.text);
        }
        return {
          ...composed,
          text: checked.text,
          removed: checked.removed,
          ms: performance.now() - started,
        };
      };
      recompose = async () => {
        if (!userText.trim() || approvalRequested) return undefined;
        const composed = await compose(true, gateOffer, true);
        timings.repairMs = (timings.repairMs ?? 0) + composed.ms;
        return composed.cited > 0 ? composed.text : undefined;
      };
      // Candidates are composed from the evidence as it arrives: the retrieved passages at the
      // start, again after each step with new tool results, and with the goal offer once the
      // classifier proposes one. A candidate is only used when no newer evidence exists.
      let evidenceVersion = 0;
      let gateOffer: string | undefined;
      let candidate:
        | {
            version: number;
            offer: string | undefined;
            result: Promise<Awaited<ReturnType<typeof compose>> | undefined>;
          }
        | undefined;
      // Without a confirmed goal a turn only reads. When the retrieved passages already answer
      // it (every composed fact verified), that answer is released without waiting for the
      // agent, unless the agent has started a lookup by then.
      const signal = () => {
        let resolve = (): void => {};
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        return { promise, resolve };
      };
      let directSignal = signal();
      const unknownCopy = guardCopy[guardLocale(language)].unknown;
      const directAnswer = (): boolean => !stepTools && !toolCalled && draftless();
      const startCandidate = (): void => {
        if (latest.role !== "user" || !userText.trim()) return;
        const started = {
          version: evidenceVersion,
          offer: gateOffer,
          result: compose(false, gateOffer).catch(() => undefined),
        };
        candidate = started;
        if (!pipeline.confirmed || !pipeline.goalOpen) return;
        const gate = pipeline.gate;
        void started.result.then(async (composed) => {
          if (
            !composed ||
            composed.cited === 0 ||
            composed.dropped > 0 ||
            composed.removed > 0 ||
            composed.text.includes(unknownCopy)
          )
            return;
          const decided = await gate.catch(() => undefined);
          if (decided && !decided.reply && decided.offerGoal?.goal === started.offer)
            directSignal.resolve();
        });
      };
      // Lookups whose sourced results are the whole answer: the agent's own prose adds nothing
      // the composer may state, so the turn need not wait for it.
      const draftless = (): boolean =>
        [...inputs.values()].every((call) => DRAFTLESS_TOOLS.has(call.toolName));
      let toolCalled = false;
      let offered = false;
      // Without an explicit pointer, the cursor shows the result card the answer is about.
      let pointed = false;
      const results: { toolCallId: string; toolName: string }[] = [];
      const finalize = async (): Promise<void> => {
        // The classifier's verdict (medical handoff, goal offer) is decided before any release.
        const decided = pipeline.confirmed ? await pipeline.gate : {};
        if (decided.reply) {
          output.emit(draft.id ?? randomUUID(), decided.reply);
          return;
        }
        if (openedResource(prepared.history)) output.opened();
        const resourceCalls = [...inputs.values()].some((call) =>
          call.toolName.endsWith("Resource"),
        );
        if (
          !offered &&
          !approvalRequested &&
          !pointed &&
          !resourceCalls &&
          !answersOffer(prepared.history, userText)
        ) {
          const offer = await guidanceOffer({
            userTexts: [userText, ...recentUserTexts(prepared.history, userText)],
            sources: topSources(
              [
                ...toolEvidence,
                ...searchEvidence,
                ...(pipeline.confirmed ? pipeline.passages : []),
              ],
              userText,
            ),
          });
          if (offer) {
            for (const chunk of offerChunks(randomUUID(), offer)) writer.write(chunk);
            output.offer(offer.label);
            offered = true;
          }
        }
        // The goal is offered inside the answer; a "yes" next turn confirms it.
        if (decided.offerGoal && !offered && !approvalRequested)
          writer.write({
            type: "message-metadata",
            messageMetadata: {
              pendingGoal: decided.offerGoal.goal,
              pendingLifeSituation: decided.offerGoal.lifeSituation,
            },
          });
        const id = draft.id;
        if (id === undefined) return output.finish();
        const responseCheck = async (text: string): Promise<string | undefined> => {
          const checked = await guardText(text);
          // Reason codes only: answers never reach process logs.
          console.info(
            JSON.stringify({
              event: "response_guard",
              disposition: checked.disposition,
              reason: checked.reason,
            }),
          );
          return checked.text === text ? undefined : checked.text;
        };
        // An unopened offer replaces the reply with its fixed question; the draft is not shown.
        if (offered) {
          await writeAnswer(id, draft.text);
          return output.finish(responseCheck);
        }
        if (!approvalRequested && userText.trim()) {
          try {
            const fresh =
              draftless() &&
              candidate?.version === evidenceVersion &&
              candidate.offer === decided.offerGoal?.goal
                ? await candidate.result
                : undefined;
            const composed = fresh ?? (await compose(true, decided.offerGoal?.goal));
            timings.composeMs = composed.ms;
            if (composed.text.trim()) {
              const card = pointed ? undefined : pointedToolCall(results);
              if (card) output.action(resultPointAction(randomUUID(), card));
              await writeAnswer(id, composed.text);
              // The response guard and citation verifier run beside the answer guard.
              return output.finish(responseCheck);
            }
          } catch {
            options?.abortSignal?.throwIfAborted();
            console.warn(JSON.stringify({ event: "answer_composer_failed" }));
          }
        }
        // Approval turns and composer failures keep the agent's text under the same gates.
        await writeAnswer(id, (await guardText(draft.text)).text);
        return output.finish();
      };
      const guardedWriter = createGuardedDataWriter(
        {
          write: (part) => {
            if (part.type === "data-action") {
              pointed = true;
              output.action(ActionSchema.parse(part.data));
            } else writer.write(part);
          },
        },
        guard,
        guardContext,
      );
      if (!pipeline.confirmed) {
        if (pipeline.goal)
          writer.write({
            type: "message-metadata",
            messageMetadata: {
              pendingGoal: pipeline.goal,
              pendingLifeSituation: pipeline.classification.lifeSituation,
            },
          });
        output.emit(randomUUID(), pipeline.reply);
        speechSegments.push(...output.segments);
        timings.totalMs = performance.now() - pipelineStarted;
        writer.write({ type: "finish" });
        return;
      }
      for (const passage of pipeline.passages) {
        passages.set(passage.id, passage);
        // The citation verifier deliberately accepts only its strict evidence contract.
        guardPassages.push({ id: passage.id, text: passage.text, url: passage.url });
      }
      if (pipeline.goalConfirmed)
        writer.write({
          type: "data-case-event",
          data: {
            caseId: prepared.context.caseId,
            kind: "goal_confirmed",
            payload: { goal: pipeline.goalConfirmed },
          },
        });
      const citationInstructions =
        "\nThe knowledge entries in the context are retrieved passages. Cite every substantive administrative claim inline as [passage:ID] at the end of its sentence, where ID is the id field of a knowledge entry or kb.search result, e.g. 'Der Antrag ist beim zuständigen Träger zu stellen. [passage:<id>]'. Use only retrieved passage IDs. State what is unknown. All recommendations require a source and its validity date. Never infer eligibility from medical facts. Continue only with administrative matters. Answer directly from the retrieved context when it contains the answer. Tool failures are not evidence. Use kb.search for additional passages, and do not call office/catalog tools for a simple explanation already supported by retrieved sources.";
      // Without a confirmed goal the turn only looks things up; nothing writes to the case.
      const goalInstructions = pipeline.goalOpen
        ? "\nNo case goal is confirmed yet. Answer the question directly with read-only lookups; do not ask the user to confirm a goal and do not start a process or change the case."
        : "";
      const afterOpen = openedResource(prepared.history) ? AFTER_OPEN_POLICY : "";
      const agent = createLotseAgent({
        context: prepared.context,
        administrativeOnly,
        config: turnConfig,
        telemetry,
        instructions: pipeline.instructions + citationInstructions + goalInstructions + afterOpen,
        irrelevantTools: irrelevantToolNames({
          texts: [userText, pipeline.blocks.case, pipeline.blocks.screen],
          history: prepared.history,
          screen: Boolean(
            parsed.capsule.screen ||
              parsed.capsule.page ||
              parsed.capsule.focusedRegion ||
              /formInstance/u.test(pipeline.blocks.case),
          ),
          ...(pipeline.goalOpen ? { readOnly: true } : {}),
        }),
        prepareContext: async () =>
          (await pipeline.refreshContext()) + citationInstructions + goalInstructions,
        dependencies: {
          db,
          config,
          passages,
          allowStubs: config.allowStubs,
          writer: guardedWriter,
          analytics: productEvents.sink,
          capsule: parsed.capsule,
        },
        ...(options?.model ? { model: options.model } : {}),
        checkpoint: checkpoint.wait,
        persistToolResult: approvedResultCheckpoint(prepared.history, save),
        // Tools run only after the classifier has cleared the request (it runs beside the agent).
        beforeTool: async () =>
          !(await pipeline.gate.catch(() => ({ reply: "unavailable" }))).reply,
      });
      startCandidate();
      pipeline.gate.then(
        (decided) => {
          gateOffer = decided.offerGoal?.goal;
          if (gateOffer && draftless()) startCandidate();
        },
        () => {},
      );
      const result = await agent.stream({
        messages: await convertToModelMessages(pipeline.history),
        timeout: { totalMs: PIPELINE_CONFIG.turnTimeoutMs, stepMs: PIPELINE_CONFIG.modelTimeoutMs },
        abortSignal: options?.abortSignal
          ? AbortSignal.any([options.abortSignal, cancellation.signal])
          : cancellation.signal,
      });
      const withheldInputs = new Set<string>();
      // At most one fixed status line per turn tells the user that Lotse is looking something up.
      const announce = createStatusAnnouncer(language);
      const sdkStream = result.toUIMessageStream<LotseMessage>({
        sendReasoning: false,
        sendSources: false,
        originalMessages: prepared.history,
        onError: turnStreamError,
      });
      const reader = sdkStream.getReader();
      // A lookup turn is released as soon as the agent starts writing prose (or reaches its last,
      // tool-less step): the answer is composed from the evidence, not from that prose.
      const lastStep = (turnConfig.agentMaxSteps ?? PIPELINE_CONFIG.maxSteps) - 1;
      let step = -1;
      let stepTools = false;
      let stepResults = false;
      const releasable = (): boolean =>
        latest.role === "user" &&
        Boolean(userText.trim()) &&
        !approvalRequested &&
        !failed &&
        !stepTools &&
        draftless();
      const release = async (): Promise<void> => {
        timings.earlyReleaseStep = step;
        timings.releaseAtMs = performance.now() - pipelineStarted;
        draft.id ??= randomUUID();
        if (step < 0) writer.write({ type: "start-step" });
        await guardedWriter.flush();
        await finalize();
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish" });
        speechSegments.splice(0, speechSegments.length, ...output.segments);
        timings.totalMs = performance.now() - pipelineStarted;
        // The agent's remaining prose is not needed; stop its model call.
        cancellation.abort();
        reader.cancel().catch(() => {});
      };
      let pendingRead: ReturnType<typeof reader.read> | undefined;
      try {
        while (true) {
          pendingRead ??= reader.read();
          const next = await Promise.race([
            pendingRead,
            directSignal.promise.then(() => undefined),
          ]);
          if (next === undefined) {
            directSignal = signal();
            if (directAnswer() && candidate?.version === evidenceVersion) {
              timings.directAnswer = 1;
              pendingRead.catch(() => {});
              await release();
              break;
            }
            continue;
          }
          pendingRead = undefined;
          if (next.done) break;
          const part: UIMessageChunk = next.value;
          if (part.type === "start") continue;
          if (acceptDraft(part)) {
            if (
              part.type === "text-delta" &&
              draft.text.length >= PIPELINE_CONFIG.earlyReleaseCharacters &&
              releasable()
            ) {
              await release();
              break;
            }
            continue;
          }
          if (part.type === "tool-input-start") stepTools = true;
          if (part.type === "tool-output-available") {
            evidenceVersion++;
            stepResults = true;
            const call = inputs.get(part.toolCallId);
            const offer =
              call?.toolName === "ui.offerResource"
                ? contracts["ui.offerResource"].output.safeParse(part.output)
                : undefined;
            if (call) results.push({ toolCallId: part.toolCallId, toolName: call.toolName });
            if (offer?.success && !offer.data.open) {
              output.offer(offer.data.label);
              offered = true;
            }
            if (call?.toolName === "kb.search") {
              const retrieved = contracts["kb.search"].output.safeParse(part.output);
              if (retrieved.success) {
                for (const passage of retrieved.data) passages.set(passage.id, passage);
                guardPassages.push(
                  ...retrieved.data
                    .filter(
                      (item) =>
                        !guardPassages.some(
                          (prior) =>
                            prior.id === item.id &&
                            prior.text === item.text &&
                            prior.url === item.url,
                        ),
                    )
                    .map(({ id, text, url }) => ({ id, text, url })),
                );
                searchEvidence.push(
                  ...retrieved.data.map(({ id, text, url }) => ({ id, text, url })),
                );
              }
            } else {
              toolEvidence.push(...toolSources(part.toolCallId, part.output));
            }
          }
          if (part.type === "finish-step" || part.type === "finish") {
            if (part.type === "finish-step")
              timings[`step${step}DoneAtMs`] = performance.now() - pipelineStarted;
            await guardedWriter.flush();
          }
          // New lookup results: compose the next candidate beside the agent's next step.
          if (part.type === "finish-step" && stepResults && draftless()) startCandidate();
          if (await output.write(part)) continue;
          if (part.type === "finish") await finalize();
          if (part.type === "finish-step" || part.type === "finish") {
            speechSegments.splice(0, speechSegments.length, ...output.segments);
            timings.totalMs = performance.now() - pipelineStarted;
          }
          const status = statusPart(part, announce, prepared.turnId);
          if (status) {
            writer.write(status);
            // A voice turn hears the fixed, claim-free status line right away as its first sentence.
            if (parsed.inputKind === "transcript") {
              output.emit(randomUUID(), status.data.text);
              speechSegments.splice(0, speechSegments.length, ...output.segments);
            }
          }
          if (
            part.type === "tool-input-start" &&
            isToolName(part.toolName) &&
            contracts[part.toolName].location === "client" &&
            contracts[part.toolName].approval
          ) {
            withheldInputs.add(part.toolCallId);
            continue;
          }
          if (part.type === "tool-input-delta" && withheldInputs.has(part.toolCallId)) continue;
          if (part.type === "tool-input-available") {
            toolCalled = true;
            inputs.set(part.toolCallId, { toolName: part.toolName, input: part.input });
            if (
              isToolName(part.toolName) &&
              contracts[part.toolName].location === "client" &&
              contracts[part.toolName].approval
            ) {
              // onToolCall fires on input-available, before SDK approval parts.
              // Populate its UI preview using input-start/delta instead. Dispatch
              // input-available only on the separately verified continuation.
              writer.write({
                type: "tool-input-start",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
              });
              writer.write({
                type: "tool-input-delta",
                toolCallId: part.toolCallId,
                inputTextDelta: canonicalJson(part.input),
              });
              continue;
            }
          }
          if (part.type === "tool-approval-request") {
            approvalRequested = true;
            const call = inputs.get(part.toolCallId);
            if (!call) throw new Error("Approval without tool input");
            const context = await approvalService.request(
              { ...call, approvalId: part.approvalId, toolCallId: part.toolCallId },
              prepared.context,
            );
            writer.write(part);
            writer.write({ type: "data-approval-context", data: context });
          } else {
            if (part.type === "error") {
              failed = true;
              checkpoint.fail(new Error("Agent stream failed"));
            }
            writer.write(next.value);
          }
          if (part.type === "start-step") {
            step++;
            timings[`step${step}AtMs`] = performance.now() - pipelineStarted;
            stepTools = false;
            stepResults = false;
            if (step >= lastStep && toolCalled && releasable()) {
              await release();
              break;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { "Cache-Control": "private, no-store", "x-lotse-case-id": prepared.context.caseId },
  });
}

export async function handleTurn(
  request: TurnRequest,
  latestMessage: unknown,
  session: SessionIdentity,
  options?: Parameters<typeof runTurn>[4],
): Promise<Response> {
  const telemetry = startTurnTelemetry();
  try {
    return await telemetry.run(() => runTurn(request, latestMessage, session, telemetry, options));
  } catch (error) {
    telemetry.end("failed");
    throw error;
  }
}

export { TurnError } from "./errors.ts";
