import { createFormViewerService, FormViewerError } from "@lotse/brain/forms/viewer";
import { FieldCorrectionSchema } from "@lotse/brain/forms/viewer/schema";
import { z } from "zod";
import { getEnvironment } from "./env.ts";
import { getDatabase, getStorage } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function formViewerResponse(
  request: Request,
  id: string,
  kind: "instance" | "pdf",
): Promise<Response> {
  try {
    const identity = await requireSession(request);
    if (
      request.method === "PATCH" &&
      (request.headers.get("sec-fetch-site") === "cross-site" ||
        (request.headers.has("origin") &&
          request.headers.get("origin") !==
            resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL)))
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403, headers });
    if (!z.uuid().safeParse(id).success)
      return Response.json({ error: "INVALID_FORM_ID" }, { status: 400, headers });
    const service = createFormViewerService(getDatabase(), identity.userId);
    if (request.method === "PATCH") {
      const input = FieldCorrectionSchema.safeParse(await request.json().catch(() => null));
      if (!input.success)
        return Response.json({ error: "INVALID_CORRECTION" }, { status: 400, headers });
      return Response.json(await service.correct(id, input.data), { headers });
    }
    const { instance, storageKey } = await service.read(id);
    if (kind === "instance") return Response.json(instance, { headers });
    const bytes = await getStorage().get(storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="form.pdf"',
      },
    });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: error.status, headers });
    const status =
      error instanceof FormViewerError
        ? { not_found: 404, invalid_input: 422, unavailable: 503 }[error.code]
        : 503;
    return Response.json({ error: "FORM_VIEWER_UNAVAILABLE" }, { status, headers });
  }
}
