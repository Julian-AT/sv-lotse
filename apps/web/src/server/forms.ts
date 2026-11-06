import { downloadFormPdf, FormError } from "@lotse/brain/forms";
import { z } from "zod";
import { formViewerResponse } from "./form-viewer.ts";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";

export async function formPdfResponse(request: Request, id: string): Promise<Response> {
  // The live viewer overlays draft fields on the original; exports contain committed values only.
  if (new URL(request.url).searchParams.get("source") === "original")
    return formViewerResponse(request, id, "pdf");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const identity = await requireSession(request);
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success)
      return Response.json({ error: "INVALID_FORM_ID" }, { status: 400, headers });
    const bytes = await downloadFormPdf(getDatabase().db, identity.userId, parsed.data);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="lotse-form.pdf"',
      },
    });
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
    return Response.json({ error: "FORM_EXPORT_FAILED" }, { status: 500, headers });
  }
}
