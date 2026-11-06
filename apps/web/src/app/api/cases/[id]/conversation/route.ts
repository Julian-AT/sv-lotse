import { loadCaseConversation } from "@lotse/brain/conversation";
import { assertJobOrigin, jobHttpError, privateHeaders } from "@/server/job-http.ts";
import { getDatabase } from "@/server/resources.ts";
import { requireSession } from "@/server/session.ts";

export const runtime = "nodejs";

async function respond(
  request: Request,
  context: { params: Promise<{ id: string }> },
  resume: boolean,
): Promise<Response> {
  try {
    const identity = await requireSession(request);
    if (resume) assertJobOrigin(request);
    const { id } = await context.params;
    return Response.json(await loadCaseConversation(getDatabase().db, id, identity, resume), {
      headers: privateHeaders,
    });
  } catch (error) {
    return jobHttpError(error);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(request, context, false);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(request, context, true);
}
