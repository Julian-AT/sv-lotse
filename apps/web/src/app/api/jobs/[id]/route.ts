import { getJob } from "@lotse/brain/jobs";
import { jobHttpError, privateHeaders } from "@/server/job-http.ts";
import { getDatabase } from "@/server/resources.ts";
import { requireSession } from "@/server/session.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const identity = await requireSession(request);
    const { id } = await context.params;
    const language = request.headers.get("accept-language")?.startsWith("en") ? "en" : "de";
    return Response.json(await getJob(getDatabase().db, id, identity, language), {
      headers: privateHeaders,
    });
  } catch (error) {
    return jobHttpError(error);
  }
}
