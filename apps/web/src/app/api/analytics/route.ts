import { ANALYTICS_MAX_BODY_BYTES } from "@/analytics/config.ts";
import { hasAnalyticsConsent } from "@/analytics/consent.ts";
import { exportAnalytics } from "@/analytics/server.ts";
import { getEnvironment } from "@/server/env.ts";
import { requireSession, SessionUnauthorized } from "@/server/session.ts";
import { resolveSessionOrigin } from "@/server/session-origin.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession(request);
    const config = getEnvironment();
    if (
      request.headers.get("origin") !== resolveSessionOrigin(request, config.LOTSE_WORKSPACE_URL) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 });
    if (!hasAnalyticsConsent(request) || !config.POSTHOG_KEY)
      return new Response(null, { status: 204 });
    // Bound the actual stream, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "INVALID_EVENT" }, { status: 400 });
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > ANALYTICS_MAX_BODY_BYTES) {
          await reader.cancel();
          return Response.json({ error: "EVENT_TOO_LARGE" }, { status: 413 });
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = await exportAnalytics(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      config,
    );
    return result === "invalid"
      ? Response.json({ error: "INVALID_EVENT" }, { status: 400 })
      : new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: 401 });
    return Response.json({ error: "INVALID_EVENT" }, { status: 400 });
  }
}
