import { createPreferencesService, PreferencesError } from "@lotse/brain/preferences";
import { preferencesPatchSchema } from "@lotse/brain/preferences/schema";
import { NextResponse } from "next/server";
import { ANALYTICS_PREFERENCE_KEY } from "@/analytics/config.ts";
import { getEnvironment } from "@/server/env.ts";
import { getDatabase } from "@/server/resources.ts";
import { requireSession, SessionUnauthorized } from "@/server/session.ts";
import { cookieOptions } from "@/server/session-cookie.ts";
import { resolveSessionOrigin } from "@/server/session-origin.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return respond(request, false);
}

export async function PATCH(request: Request): Promise<Response> {
  return respond(request, true);
}

async function respond(request: Request, write: boolean): Promise<Response> {
  try {
    const session = await requireSession(request);
    const origin = request.headers.get("origin");
    if (
      write &&
      ((origin && origin !== resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL)) ||
        request.headers.get("sec-fetch-site") === "cross-site")
    )
      return NextResponse.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 });
    const service = createPreferencesService(getDatabase().db, session.userId);
    const patch = write ? preferencesPatchSchema.safeParse(await request.json()) : undefined;
    if (patch && !patch.success)
      return NextResponse.json({ error: "INVALID_PREFERENCES" }, { status: 400 });
    const preferences = patch?.success ? await service.update(patch.data) : await service.read();
    const response = NextResponse.json(preferences, {
      headers: { "Cache-Control": "private, no-store" },
    });
    if (patch?.success && patch.data.analyticsConsent !== undefined)
      response.cookies.set(ANALYTICS_PREFERENCE_KEY, preferences.analyticsConsent ? "1" : "0", {
        ...cookieOptions(getEnvironment().LOTSE_WORKSPACE_URL, request),
        sameSite: "strict",
      });
    if (write)
      response.cookies.set("lotse_language", preferences.language, {
        path: "/",
        sameSite: "lax",
        secure: resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL).startsWith(
          "https:",
        ),
        httpOnly: true,
      });
    return response;
  } catch (error) {
    if (error instanceof SessionUnauthorized || error instanceof PreferencesError)
      return NextResponse.json({ error: error.code }, { status: error.status });
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "INVALID_PREFERENCES" }, { status: 400 });
    return NextResponse.json({ error: "PREFERENCES_FAILED" }, { status: 500 });
  }
}
