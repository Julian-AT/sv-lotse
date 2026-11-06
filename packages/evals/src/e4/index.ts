import type { BrainConfig } from "@lotse/brain/config";
import type { Database } from "@lotse/db";
import { z } from "zod";
import { E4_CONFIG } from "../config.ts";
import { judge, type Rubric } from "../judge/index.ts";
import { simulatePersona } from "../persona/index.ts";
import type { RegisteredSuite } from "../runner/index.ts";
import type { Evaluation, JudgeResult } from "../schema/index.ts";
import { PersistedSystemUnderTest } from "./adapter.ts";
import { openingFor, type ScenarioData, ScenarioInputSchema } from "./data.ts";

/** Full anchors are necessary; persona self-reported completion never overrides missing evidence. */
export function scenarioScore(
  rubric: Rubric,
  result: JudgeResult,
  baselineAvailable: boolean,
  pipelineFailed: boolean,
): Evaluation {
  const metrics = Object.fromEntries(
    rubric.criteria.map((criterion) => [criterion.id, result.scores[criterion.id]?.score ?? 0]),
  );
  const maximum = rubric.criteria.every(
    (criterion) => result.scores[criterion.id]?.score === (criterion.scale === "binary" ? 1 : 2),
  );
  const needsEngine = rubric.criteria.some((criterion) =>
    Object.values(criterion.anchors).some((anchor) =>
      /baseline is unavailable|do not report a task-success/iu.test(anchor),
    ),
  );
  const verified = (!needsEngine || baselineAvailable) && !pipelineFailed;
  return {
    passed: maximum && verified,
    metrics: {
      ...metrics,
      taskSuccess: Number(maximum && verified),
      questionBaselineAvailable: Number(baselineAvailable),
      pipelineFailed: Number(pipelineFailed),
    },
    judge: result,
  };
}

export interface E4Diagnostic {
  caseId: string;
  scenario: string;
  personaStatus: string;
  personaModel: string;
  personaPromptVersion: string;
  turns: number;
  questionBaselines: number;
  evidence: z.infer<ReturnType<typeof z.json>>;
}

/** Only counts/statuses/opaque ids leave memory; transcripts and document/tool payloads do not. */
export function safeEvidence(
  raw: z.infer<ReturnType<typeof z.json>>,
): z.infer<ReturnType<typeof z.json>> {
  const parsed = z
    .object({
      caseId: z.string(),
      record: z.object({ confirmed_goal: z.string(), status: z.string() }),
      turns: z.array(z.object({ status: z.string(), model_ids: z.json() })),
      tools: z.array(
        z.object({ type: z.string(), state: z.string(), errorText: z.string().optional() }),
      ),
      approvals: z.array(
        z.object({
          tool_name: z.string(),
          decision: z.enum(["pending", "approved", "denied"]),
          consumed: z.boolean(),
        }),
      ),
      importedDocumentId: z.string().nullable(),
      questionBaselines: z.array(z.json()),
    })
    .parse(raw);
  return {
    caseId: parsed.caseId,
    goalConfirmed: Boolean(parsed.record.confirmed_goal),
    status: parsed.record.status,
    turns: parsed.turns,
    tools: parsed.tools.map(({ type, state }) => ({ type, state })),
    approvals: parsed.approvals,
    importedDocumentId: parsed.importedDocumentId,
    questionBaselineCount: parsed.questionBaselines.length,
  };
}

export function createE4Suite(
  data: readonly ScenarioData[],
  database: Database,
  config: BrainConfig,
  onResult?: (diagnostic: E4Diagnostic) => Promise<void>,
): RegisteredSuite {
  const slices = new Map(
    data.flatMap((slice) => slice.cases.map((item) => [item.id, slice] as const)),
  );
  return {
    suite: {
      id: "E4",
      name: "Persisted multi-turn administrative scenarios",
      gate: {
        kind: "informational",
        metric: "taskSuccess",
        threshold: E4_CONFIG.successThreshold,
        direction: "at_least",
      },
      minimumSetSize: E4_CONFIG.minimumReleaseRuns,
    },
    cases: data.flatMap((slice) => slice.cases),
    async execute(item, { signal }) {
      const slice = slices.get(item.id);
      if (!slice) throw new Error("missing_scenario");
      const input = ScenarioInputSchema.parse(item.input);
      const system = new PersistedSystemUnderTest(database, config, input);
      try {
        const run = await simulatePersona(input.persona, system, {
          maxTurns: E4_CONFIG.maxTurns,
          timeoutMs: E4_CONFIG.timeoutMs,
          openingUtterance: openingFor(input),
          signal,
        });
        const evidence = await system.evidence();
        const scored = await judge(
          {
            transcript: run.turns.flatMap((turn) => [
              { role: "user" as const, text: turn.user },
              { role: "assistant" as const, text: turn.assistant },
            ]),
            expected: JSON.stringify({
              expected: item.expected,
              sources: slice.sources,
              actualEvidence: evidence,
              events: run.turns.map((turn) => turn.events),
              personaStatus: run.status,
              scoringInstructions:
                "Use actual persisted tool outputs and approvals to verify actions. Assistant claims alone are not evidence. Honor the case's question baseline: runtime_process_engine requires replay evidence; explicitly authored lower bounds allow only provisional credit labeled as authored, never engine-verified credit. Native/voice capabilities marked false are untested, not completed. Do not award a readability review that was not recorded.",
            }),
          },
          slice.rubric,
          signal,
        );
        const diagnostic = safeEvidence(evidence);
        await onResult?.({
          caseId: item.id,
          scenario: slice.scenario,
          personaStatus: run.status,
          personaModel: run.model,
          personaPromptVersion: run.promptVersion,
          turns: run.turns.length,
          questionBaselines: system.questionBaselines.length,
          evidence: diagnostic,
        });
        const failed = z
          .object({ turns: z.array(z.object({ status: z.string() })) })
          .parse(evidence)
          .turns.some((turn) => ["failed", "interrupted", "running"].includes(turn.status));
        return scenarioScore(slice.rubric, scored, system.questionBaselines.length > 0, failed);
      } finally {
        system.close();
      }
    },
  };
}

export { PersistedSystemUnderTest } from "./adapter.ts";
export { loadScenarios, type Scenario, type ScenarioData } from "./data.ts";
