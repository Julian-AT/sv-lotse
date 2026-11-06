import type { DatabaseClient } from "@lotse/db";
import { JsonValueSchema } from "@lotse/protocol";
import { allowedToolNames } from "../agent/permissions.ts";
import { resolveContext } from "../conversation/store.ts";
import { contracts } from "../tools/contracts/index.ts";
import { buildTools } from "../tools/registry.ts";
import { JobError, type JobState, type JobTask } from "./schema.ts";

export type JobStep = {
  jobId: string;
  caseId: string;
  index: number;
  task: JobTask;
  identity: JobState["identity"];
  signal: AbortSignal;
};
export type JobExecutor = (step: JobStep) => Promise<unknown>;

export function createJobExecutor(db: DatabaseClient): JobExecutor {
  const tools = buildTools({ db, allowStubs: false });
  return async (step) => {
    const context = await db.transaction((tx) =>
      resolveContext(
        tx,
        {
          caseId: step.caseId,
          inputKind: "text",
          capsule: {},
          actionResults: [],
        },
        step.identity,
      ),
    );
    // Background work has no approval or native capability channel.
    if (
      context.actorRole !== "subject" ||
      !allowedToolNames(context.autonomyLevel, context.actorRole).includes(step.task.toolName)
    )
      throw new JobError("INVALID_JOB", 403);
    const definition = tools[step.task.toolName];
    if (!definition.execute) throw new JobError("INVALID_JOB", 400);
    const input = contracts[step.task.toolName].input.parse(step.task.input);
    if (
      ("caseId" in step.task.input && step.task.input.caseId !== context.caseId) ||
      ("subjectId" in step.task.input && step.task.input.subjectId !== context.subjectId)
    )
      throw new JobError("INVALID_JOB", 403);
    const result = await definition.execute(input, {
      toolCallId: `${step.jobId}:${step.index}`,
      messages: [],
      context,
      abortSignal: step.signal,
    });
    return JsonValueSchema.parse(contracts[step.task.toolName].output.parse(result));
  };
}
