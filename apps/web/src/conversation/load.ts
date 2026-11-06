import type { LotseMessage } from "@lotse/brain";
import type { CaseConversationSnapshot } from "@lotse/brain/conversation";
import { DATA_PARTS, type JobProgress, JobProgressSchema } from "@lotse/protocol";
import { validateUIMessages } from "ai";
import { z } from "zod";

const jobPartSchema = z.strictObject({
  type: z.literal("data-job-progress"),
  id: z.string(),
  data: JobProgressSchema,
});
const snapshotSchema = z.strictObject({
  caseId: z.uuid(),
  subjectId: z.uuid(),
  messages: z.array(z.unknown()),
  jobs: z.array(jobPartSchema),
});

export async function loadConversation(
  caseId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CaseConversationSnapshot> {
  z.uuid().parse(caseId);
  const response = await fetcher(`/api/cases/${caseId}/conversation`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("CONVERSATION_LOAD_FAILED");
  const snapshot = snapshotSchema.parse(await response.json());
  if (snapshot.caseId !== caseId) throw new Error("CONVERSATION_LOAD_FAILED");
  return {
    ...snapshot,
    messages:
      snapshot.messages.length === 0
        ? []
        : await validateUIMessages<LotseMessage>({
            messages: snapshot.messages,
            dataSchemas: DATA_PARTS,
          }),
  };
}

export async function loadJobProgress(id: string, signal: AbortSignal): Promise<JobProgress> {
  z.uuid().parse(id);
  const response = await fetch(`/api/jobs/${id}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("JOB_LOAD_FAILED");
  const parsed = z.object({ part: jobPartSchema }).parse(await response.json());
  if (parsed.part.data.jobId !== id) throw new Error("JOB_LOAD_FAILED");
  return parsed.part.data;
}
