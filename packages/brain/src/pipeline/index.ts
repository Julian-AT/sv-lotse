import type { DatabaseClient } from "@lotse/db";
import { cases } from "@lotse/db/schema";
import { lifeSituationKey } from "@lotse/knowledge/life-situations";
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
      classification: Classification;
      confirmed: true;
      goalConfirmed: string | undefined;
      /** No case goal is confirmed yet: the turn answers read-only. */
      goalOpen: boolean;
      /** A process goal to offer at the end of the answer; a "yes" confirms it next turn. */
      offerGoal?: { goal: string; lifeSituation: string | null };
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
    const classification: Classification = {
      language,
      intent: "confirmation",
      // Stored cases may hold an earlier spelling; only a vocabulary key is a classification.
      lifeSituation: state.record.lifeSituation
        ? (lifeSituationKey(state.record.lifeSituation) ?? null)
        : null,
      candidateGoal: null,
      confirmsPendingGoal: false,
      factTypes: [],
    };
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
      classification,
      confirmed: true,
      ...context,
      goalConfirmed: undefined,
      goalOpen: !state.record.confirmedGoal,
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
  const classification = await classifyInput(
    options.config,
    text,
    language,
    last?.role === "user" ? candidate : undefined,
    options.abortSignal,
  );
  if (options.timings) options.timings.classificationMs = performance.now() - classificationStarted;
  const copy = copyFor(classification.language);
  const previous = metadataSchema.safeParse(
    options.history.findLast((message) => message.role === "assistant")?.metadata,
  );
  let justConfirmed = false;
  if (
    !state.record.confirmedGoal &&
    candidate &&
    classification.confirmsPendingGoal &&
    (await explicitlyConfirmsGoal(text)) &&
    last?.role === "user" &&
    options.context.actorRole === "subject"
  ) {
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
  // Informational questions are answered directly. A process goal is never confirmed in a
  // separate turn: the answer ends with an offer to start it, and a "yes" confirms it.
  if (
    !state.record.confirmedGoal &&
    classification.intent === "other" &&
    !classification.candidateGoal
  )
    return {
      language: classification.language,
      classification,
      confirmed: false as const,
      goal: undefined,
      reply: copy.clarifyGoal,
    };
  if (classification.intent === "medical")
    return {
      language: classification.language,
      classification,
      confirmed: false as const,
      goal: undefined,
      reply: copy.handoff,
    };
  const goalOpen = !state.record.confirmedGoal;
  const query = goalOpen
    ? text
    : justConfirmed || classification.intent === "confirmation"
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
    classification.factTypes,
    options.request.capsule,
    passages,
    options.history,
  );
  if (options.timings) options.timings.assemblyMs = performance.now() - assemblyStarted;
  return {
    language: classification.language,
    classification,
    confirmed: true as const,
    ...context,
    goalConfirmed: justConfirmed ? candidate : undefined,
    goalOpen,
    ...(goalOpen && classification.candidateGoal
      ? {
          offerGoal: {
            goal: classification.candidateGoal,
            lifeSituation: classification.lifeSituation,
          },
        }
      : {}),
    refreshContext: async (): Promise<string> => {
      const next = await assembleContext(
        options.db,
        options.context,
        await loadTurnState(options.db, options.context),
        classification.factTypes,
        options.request.capsule,
        passages,
        options.history,
      );
      return next.instructions;
    },
  };
}
