import { RESOLVE_MAX_BODY_BYTES, ResolveError, resolveTarget } from "@lotse/brain/resolve";
import { getEnvironment } from "@/server/env.ts";
import { requireSession, SessionUnauthorized } from "@/server/session.ts";
import { resolveSessionOrigin } from "@/server/session-origin.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    await requireSession(request);
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403, headers });
    // Bound the stream too: Content-Length alone is not a trusted limit.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "INVALID_RESOLVE" }, { status: 400, headers });
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESOLVE_MAX_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ error: "INVALID_RESOLVE" }, { status: 413, headers });
      }
      chunks.push(value);
    }
    return Response.json(
      await resolveTarget(JSON.parse(Buffer.concat(chunks).toString("utf8")), request.signal),
      { headers },
    );
  } catch (error) {
    if (error instanceof SessionUnauthorized || error instanceof ResolveError)
      return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof SyntaxError)
      return Response.json({ error: "INVALID_RESOLVE" }, { status: 400, headers });
    return Response.json({ error: "RESOLVE_FAILED" }, { status: 502, headers });
  }
}
