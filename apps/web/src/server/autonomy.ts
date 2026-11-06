import { AutonomyError, autonomyFillPages, createAutonomyService } from "@lotse/brain/autonomy";
import { getEnvironment } from "./env.ts";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

export async function autonomyResponse(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const identity = await requireSession(request);
    if (request.method === "PATCH") {
      const origin = request.headers.get("origin");
      const expected = resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL);
      if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site")
        return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403, headers });
    }
    const service = createAutonomyService(getDatabase().db, identity.userId);
    const result =
      request.method === "PATCH"
        ? await service.change(await request.json().catch(() => null))
        : await service.read();
    const includePages =
      request.method === "GET" && new URL(request.url).searchParams.get("include") === "fill-pages";
    return Response.json(
      includePages
        ? {
            ...result,
            allowedFillPages: await autonomyFillPages(getDatabase().db, identity.userId),
          }
        : result,
      { headers },
    );
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof AutonomyError)
      return Response.json(
        { error: error.code },
        { status: error.code === "INVALID_AUTONOMY" ? 400 : 403, headers },
      );
    return Response.json({ error: "AUTONOMY_FAILED" }, { status: 500, headers });
  }
}
