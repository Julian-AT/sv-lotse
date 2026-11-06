import { enqueueJob } from "@lotse/brain/jobs";
import { assertJobOrigin, jobHttpError, privateHeaders } from "@/server/job-http.ts";
import { getDatabase } from "@/server/resources.ts";
import { requireSession } from "@/server/session.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const identity = await requireSession(request);
    assertJobOrigin(request);
    return Response.json(await enqueueJob(getDatabase().db, await request.json(), identity), {
      status: 202,
      headers: privateHeaders,
    });
  } catch (error) {
    return jobHttpError(error);
  }
}
