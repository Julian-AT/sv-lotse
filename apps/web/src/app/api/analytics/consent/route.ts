import { NextResponse } from "next/server";
import { z } from "zod";
import { ANALYTICS_PREFERENCE_KEY } from "@/analytics/config.ts";
import { hasAnalyticsConsent } from "@/analytics/consent.ts";
import { getEnvironment } from "@/server/env.ts";
import { requireSession, SessionUnauthorized } from "@/server/session.ts";
import { cookieOptions } from "@/server/session-cookie.ts";
import { resolveSessionOrigin } from "@/server/session-origin.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession(request);
    return Response.json(
      { consent: hasAnalyticsConsent(request) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: 401 });
    return Response.json({ error: "CONSENT_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession(request);
    const config = getEnvironment();
    if (
      request.headers.get("origin") !== resolveSessionOrigin(request, config.LOTSE_WORKSPACE_URL) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 });
    const parsed = z
      .object({ consent: z.boolean() })
      .strict()
      .safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "INVALID_CONSENT" }, { status: 400 });
    const response = NextResponse.json(parsed.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
    response.cookies.set(ANALYTICS_PREFERENCE_KEY, parsed.data.consent ? "1" : "0", {
      ...cookieOptions(config.LOTSE_WORKSPACE_URL, request),
      sameSite: "strict",
    });
    return response;
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: 401 });
    return Response.json({ error: "INVALID_CONSENT" }, { status: 400 });
  }
}
