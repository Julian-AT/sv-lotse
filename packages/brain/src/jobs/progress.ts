import type { jobs } from "@lotse/db/schema";
import { type JobProgress, JobProgressSchema } from "@lotse/protocol";
import { jobCopy } from "./copy.ts";
import { jobStateSchema } from "./schema.ts";

export type JobProgressPart = { type: "data-job-progress"; id: string; data: JobProgress };

export function jobProgress(
  job: typeof jobs.$inferSelect,
  language: "de" | "en" = "de",
): JobProgress {
  const parsed = jobStateSchema.safeParse(job.stepState);
  return JobProgressSchema.parse({
    jobId: job.id,
    state: job.status,
    progress:
      job.status === "completed"
        ? 1
        : parsed.success
          ? parsed.data.nextStep / parsed.data.tasks.length
          : 0,
    message: jobCopy[language][job.status],
  });
}
