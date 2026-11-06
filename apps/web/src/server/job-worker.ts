import { runJobs } from "@lotse/brain/jobs";
import { isCronAuthorized } from "./cron.ts";
import { getEnvironment } from "./env.ts";
import { jobHttpError, privateHeaders } from "./job-http.ts";
import { getDatabase } from "./resources.ts";

/** Cron-only worker batch: the bearer `CRON_SECRET` is checked before the database is opened. */
export async function jobWorkerResponse(request: Request): Promise<Response> {
  try {
    if (!isCronAuthorized(request, getEnvironment().CRON_SECRET))
      return Response.json(
        { error: "CRON_UNAUTHORIZED" },
        { status: 401, headers: privateHeaders },
      );
    return Response.json({ parts: await runJobs(getDatabase().db) }, { headers: privateHeaders });
  } catch (error) {
    return jobHttpError(error);
  }
}
