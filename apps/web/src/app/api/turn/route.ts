import { handleTurn, parseTurnBody, TurnError } from "@lotse/brain";
import { getEnvironment } from "../../../server/env.ts";
import { requireSession, SessionUnauthorized } from "../../../server/session.ts";
import { resolveSessionOrigin } from "../../../server/session-origin.ts";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireSession(request);
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 });
    const { turn, latestMessage } = parseTurnBody(await request.json());
    return await handleTurn(turn, latestMessage, session, { abortSignal: request.signal });
  } catch (error) {
    if (error instanceof SessionUnauthorized || error instanceof TurnError)
      return Response.json({ error: error.code }, { status: error.status });
    if (error instanceof SyntaxError)
      return Response.json({ error: "INVALID_TURN" }, { status: 400 });
    return Response.json({ error: "TURN_FAILED" }, { status: 500 });
  }
}
