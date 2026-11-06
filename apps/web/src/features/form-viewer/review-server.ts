import { FormError, reviewTemplate } from "@lotse/brain/forms";
import { ReviewTemplateSchema } from "@lotse/brain/forms/registry/schema";
import { z } from "zod";
import { getEnvironment } from "@/server/env.ts";
import { getDatabase } from "@/server/resources.ts";
import { requireSession, SessionUnauthorized } from "@/server/session.ts";
import { resolveSessionOrigin } from "@/server/session-origin.ts";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function formTemplateReviewResponse(request: Request, id: string): Promise<Response> {
  try {
    const identity = await requireSession(request);
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !==
          resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL))
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403, headers });
    const input = ReviewTemplateSchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(id).success || !input.success)
      return Response.json({ error: "INVALID_REVIEW" }, { status: 400, headers });
    return Response.json(await reviewTemplate(getDatabase().db, identity.userId, id, input.data), {
      headers,
    });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: error.status, headers });
    const status = error instanceof FormError ? reviewErrorStatus(error) : 503;
    return Response.json({ error: "FORM_REVIEW_FAILED" }, { status, headers });
  }
}

function reviewErrorStatus(error: FormError): number {
  if (error.code === "access_denied") return 403;
  if (error.code === "not_found") return 404;
  if (error.code === "invalid_fields") return 409;
  if (error.code === "unsupported_format") return 422;
  return 503;
}
