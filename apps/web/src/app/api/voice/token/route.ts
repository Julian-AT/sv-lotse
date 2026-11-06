import {
  createVoiceToken,
  createVoiceTokenLimiter,
  VoiceError,
  VoiceTokenRequestSchema,
  voiceConfiguration,
} from "@lotse/brain/voice";
import { getEnvironment } from "@/server/env.ts";
import { requireSession, SessionUnauthorized } from "@/server/session.ts";
import { resolveSessionOrigin } from "@/server/session-origin.ts";
import { voiceConfig } from "@/voice/config.ts";

export const runtime = "nodejs";

const limit = createVoiceTokenLimiter();
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Origin" };

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);
    const config = getEnvironment();
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== resolveSessionOrigin(request, config.LOTSE_WORKSPACE_URL)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403, headers });
    const input = VoiceTokenRequestSchema.safeParse(await request.json());
    if (!input.success)
      return Response.json({ error: "INVALID_VOICE_REQUEST" }, { status: 400, headers });
    limit(session.sessionId);
    const token = await createVoiceToken(
      input.data,
      voiceConfiguration({ ...process.env, ...config }),
      request.signal,
    );
    return Response.json({ ...token, expiresIn: voiceConfig.tokenLifetimeSeconds }, { headers });
  } catch (error) {
    if (error instanceof SessionUnauthorized || error instanceof VoiceError)
      return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof SyntaxError)
      return Response.json({ error: "INVALID_VOICE_REQUEST" }, { status: 400, headers });
    return Response.json({ error: "VOICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
