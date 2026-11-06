import {
  ProfileSettingsPatchSchema,
  readProfileSettings,
  updateProfileSettings,
} from "@lotse/brain/language";
import { getEnvironment } from "./env.ts";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function profileResponse(request: Request): Promise<Response> {
  try {
    const identity = await requireSession(request);
    const db = getDatabase().db;
    if (request.method === "GET")
      return Response.json(await readProfileSettings(db, identity.userId), {
        headers: privateHeaders,
      });
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json(
        { error: "ORIGIN_NOT_ALLOWED" },
        { status: 403, headers: privateHeaders },
      );
    const body: unknown = await request.json().catch(() => undefined);
    const parsed = ProfileSettingsPatchSchema.safeParse(body);
    if (!parsed.success)
      return Response.json(
        { error: "INVALID_PROFILE_SETTINGS" },
        { status: 400, headers: privateHeaders },
      );
    const settings = await updateProfileSettings(db, identity.userId, parsed.data);
    return Response.json(settings, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json(
        { error: error.code },
        { status: error.status, headers: privateHeaders },
      );
    return Response.json(
      { error: "PROFILE_SETTINGS_FAILED" },
      { status: 500, headers: privateHeaders },
    );
  }
}
