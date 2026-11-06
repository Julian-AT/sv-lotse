import { acquireForm, FormError, findForms } from "@lotse/brain/forms";
import { z } from "zod";
import { getEnvironment } from "./env.ts";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const Search = z.strictObject({
  need: z.string().trim().min(1),
  region: z.string().optional(),
  carrier: z.string().optional(),
});
const Registration = z.strictObject({ url: z.url(), approved: z.boolean() });

export async function formTemplatesResponse(request: Request): Promise<Response> {
  try {
    await requireSession(request);
    if (request.method === "GET") {
      const input = Search.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!input.success)
        return Response.json({ error: "INVALID_FORM_SEARCH" }, { status: 400, headers });
      return Response.json(await findForms(getDatabase().db, input.data, request.signal), {
        headers,
      });
    }
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !==
          resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL))
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403, headers });
    const input = Registration.safeParse(await request.json().catch(() => null));
    if (!input.success)
      return Response.json({ error: "INVALID_FORM_REGISTRATION" }, { status: 400, headers });
    if (!input.data.approved) return Response.json({ registered: false }, { headers });
    const template = await acquireForm(getDatabase().db, input.data.url, request.signal);
    return Response.json(
      {
        id: template.id,
        title: template.title,
        publisher: template.publisher,
        url: template.source,
        versionDate: template.versionDate,
        hash: template.hash,
        retrievedAt: template.retrievedAt.toISOString(),
        format: template.format,
        pages: template.pages,
        status: template.status,
      },
      { status: 201, headers },
    );
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof FormError)
      return Response.json(
        { error: error.message },
        {
          status:
            error.code === "origin_denied" ? 403 : error.code === "unsupported_format" ? 422 : 502,
          headers,
        },
      );
    return Response.json({ error: "FORM_TEMPLATES_FAILED" }, { status: 500, headers });
  }
}
