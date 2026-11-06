import { buildFormPackageForSession, FormError } from "@lotse/brain/forms";
import { z } from "zod";
import { analyticsSink } from "../analytics/emit.ts";
import { getEnvironment } from "./env.ts";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function formPackageResponse(request: Request, id: string): Promise<Response> {
  try {
    const identity = await requireSession(request);
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !==
          resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL))
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403, headers });
    if (!z.uuid().safeParse(id).success)
      return Response.json({ error: "INVALID_FORM_ID" }, { status: 400, headers });
    const result = await buildFormPackageForSession(
      getDatabase().db,
      identity,
      id,
      analyticsSink(request),
    );
    return Response.json(
      {
        attachmentChecklist: result.attachmentChecklist,
        coverLetter: result.coverLetter,
        pdfUrl: `/api/forms/instances/${encodeURIComponent(id)}/pdf`,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof FormError) {
      const status =
        error.code === "access_denied"
          ? 403
          : error.code === "not_found"
            ? 404
            : error.code === "invalid_fields"
              ? 409
              : 500;
      return Response.json({ error: error.message }, { status, headers });
    }
    return Response.json({ error: "FORM_PACKAGE_FAILED" }, { status: 500, headers });
  }
}
