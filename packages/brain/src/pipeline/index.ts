import type { DatabaseClient } from "@lotse/db";
import { cases } from "@lotse/db/schema";
import type { TurnRequest } from "@lotse/protocol";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import { type BrainConfig, PIPELINE_CONFIG } from "../config/index.ts";
import { type AssembledContext, assembleContext, loadTurnState } from "../context/index.ts";
import { lockTurnClaim } from "../conversation/store.ts";
import { searchKnowledge } from "../retrieval/index.ts";
import type { LotseMessage } from "../tools/types.ts";
import { type Classification, classifyInput } from "./classify.ts";
import { copyFor } from "./copy.ts";
import { explicitlyConfirmsGoal } from "./guards.ts";

const metadataSchema = z.object({
  pendingGoal: z.string().min(1).optional(),
  pendingLifeSituation: z.string().nullable().optional(),
});
export function messageText(message?: LotseMessage): string {
  return (
    message?.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? ""
  );
}
export function pendingGoal(history: LotseMessage[]): string | undefined {
  const assistant = history.findLast((message) => message.role === "assistant");
  const parsed = metadataSchema.safeParse(assistant?.metadata);
  return parsed.success ? parsed.data.pendingGoal : undefined;
}
export interface PipelineGate {
  /** A fixed reply replaces the answer (medical handoff, or a question without a task). */
  reply?: string;
  /** A process goal to offer at the end of the answer; a "yes" confirms it next turn. */
  offerGoal?: { goal: string; lifeSituation: string | null };
}
export type PreparedPipeline =
  | {
      language: string;
      classification: Classification;
      confirmed: false;
      goal: string | undefined;
      reply: string;
    }
  | (AssembledContext & {
      language: string;
      confirmed: true;
      goalConfirmed: string | undefined;
      /** No case goal is confirmed yet: the turn answers read-only. */
      goalOpen: boolean;
      /** The classifier's verdict; tools and the answer's release wait for it. */
      gate: Promise<PipelineGate>;
      refreshContext: () => Promise<string>;
    });
export async function preparePipeline(options: {
  db: DatabaseClient;
  config: BrainConfig;
  context: RuntimeContext;
  turnId: string;
  request: TurnRequest;
  history: LotseMessage[];
  abortSignal?: AbortSignal;
  timings?: Record<string, number>;
}): Promise<PreparedPipeline> {
  const state = await loadTurnState(options.db, options.context);
  const last = options.history.at(-1);
  const latestUser = options.history.findLast((message) => message.role === "user");
  const candidate = pendingGoal(options.history);
  const language = options.request.language ?? state.profile?.language ?? "de-AT";
  // An authenticated assistant continuation contains an approval decision or a tool result,
  // not a new user utterance. Execute its already-authorized work before another model call.
  // In particular, a classifier/embedding outage must not strand a consumed approval.
  if (last?.role === "assistant") {
    const context = await assembleContext(
      options.db,
      options.context,
      state,
      [],
      options.request.capsule,
      [],
      options.history,
    );
    return {
      language,
      confirmed: true,
      ...context,
      goalConfirmed: undefined,
      goalOpen: !state.record.confirmedGoal,
      gate: Promise.resolve({}),
      refreshContext: async (): Promise<string> =>
        (
          await assembleContext(
            options.db,
            options.context,
            await loadTurnState(options.db, options.context),
            [],
            options.request.capsule,
            [],
            options.history,
          )
        ).instructions,
    };
  }
  const text = messageText(latestUser);
  const classificationStarted = performance.now();
  const classifying = classifyInput(
    options.config,
    text,
    language,
    last?.role === "user" ? candidate : undefined,
    options.abortSignal,
  ).then((classification) => {
    if (options.timings)
      options.timings.classificationMs = performance.now() - classificationStarted;
    return classification;
  });
  // Rejections surface through the gate; this only keeps an unawaited failure from crashing.
  classifying.catch(() => {});
  const previous = metadataSchema.safeParse(
    options.history.findLast((message) => message.role === "assistant")?.metadata,
  );
  let justConfirmed = false;
  // Only a reply that may confirm the offered goal waits for the classifier: it can change the
  // case before the agent runs. Every other turn starts retrieval and the agent right away; the
  // classifier's verdict gates tool execution and the release of the answer.
  let classified: Classification | undefined;
  if (
    !state.record.confirmedGoal &&
    candidate &&
    last?.role === "user" &&
    options.context.actorRole === "subject" &&
    (await explicitlyConfirmsGoal(text))
  ) {
    classified = await classifying;
    if (classified.confirmsPendingGoal) {
      const classification = classified;
      await options.db.transaction(async (tx) => {
        await lockTurnClaim(tx, options.context.caseId, options.turnId);
        await tx
          .update(cases)
          .set({
            confirmedGoal: candidate,
            lifeSituation:
              classification.lifeSituation ??
              (previous.success ? previous.data.pendingLifeSituation : null),
          })
          .where(eq(cases.id, options.context.caseId));
      });
      state.record.confirmedGoal = candidate;
      justConfirmed = true;
    }
  }
  const goalOpen = !state.record.confirmedGoal;
  // Informational questions are answered directly. A process goal is never confirmed in a
  // separate turn: the answer ends with an offer to start it, and a "yes" confirms it.
  const gate = classifying.then((classification): PipelineGate => {
    const copy = copyFor(classification.language);
    if (classification.intent === "medical") return { reply: copy.handoff };
    if (goalOpen && classification.intent === "other" && !classification.candidateGoal)
      return { reply: copy.clarifyGoal };
    return goalOpen && classification.candidateGoal
      ? {
          offerGoal: {
            goal: classification.candidateGoal,
            lifeSituation: classification.lifeSituation,
          },
        }
      : {};
  });
  if (classified) {
    const decided = await gate;
    if (decided.reply)
      return {
        language: classified.language,
        classification: classified,
        confirmed: false as const,
        goal: undefined,
        reply: decided.reply,
      };
  }
  const factTypes = classified?.factTypes ?? [];
  const query = goalOpen
    ? text
    : justConfirmed
      ? state.record.confirmedGoal
      : `${state.record.confirmedGoal}\n${text}`;
  const retrievalStarted = performance.now();
  const passages = await searchKnowledge(
    options.db,
    options.config,
    {
      query,
      filters: {
        ...(state.profile?.carrier ? { carrier: state.profile.carrier } : {}),
        ...(state.profile?.region ? { region: state.profile.region } : {}),
      },
      k: PIPELINE_CONFIG.retrievalK,
    },
    options.abortSignal,
  );
  if (options.timings) options.timings.retrievalMs = performance.now() - retrievalStarted;
  const assemblyStarted = performance.now();
  const context = await assembleContext(
    options.db,
    options.context,
    state,
    factTypes,
    options.request.capsule,
    passages,
    options.history,
  );
  if (options.timings) options.timings.assemblyMs = performance.now() - assemblyStarted;
  return {
    language,
    confirmed: true as const,
    ...context,
    goalConfirmed: justConfirmed ? candidate : undefined,
    goalOpen,
    gate,
    refreshContext: async (): Promise<string> => {
      const next = await assembleContext(
        options.db,
        options.context,
        await loadTurnState(options.db, options.context),
        factTypes,
        options.request.capsule,
        passages,
        options.history,
      );
      return next.instructions;
    },
  };
}
