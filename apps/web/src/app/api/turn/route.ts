import { randomUUID } from "node:crypto";
import { handleTurn, parseTurnBody, TurnError } from "@lotse/brain";
import {
  enforceTurnRateLimit,
  isApprovalAttempt,
  SessionRateLimitError,
} from "@lotse/brain/subjects";
import { hasAnalyticsConsent } from "@/analytics/consent.ts";
import { analyticsSink } from "@/analytics/emit.ts";
import { exportAnalytics } from "@/analytics/server.ts";
import { getEnvironment } from "@/server/env.ts";
import { getDatabase } from "@/server/resources.ts";
import { requireSession, SessionUnauthorized } from "@/server/session.ts";
import { resolveSessionOrigin } from "@/server/session-origin.ts";

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
    await enforceTurnRateLimit(getDatabase(), {
      userId: session.userId,
      sessionId: session.sessionId,
      caseId: turn.caseId,
      approvalAttempt: isApprovalAttempt(latestMessage),
    });
    const consent = hasAnalyticsConsent(request);
    return await handleTurn(turn, latestMessage, session, {
      abortSignal: request.signal,
      onProductEvent: analyticsSink(request),
      onTurnComplete: async (metrics) => {
        if (!consent) return;
        const language = turn.language?.split("-")[0] ?? "de";
        await exportAnalytics(
          {
            event: "turn_completed",
            properties: {
              language: ["de", "en", "tr", "bs", "hr", "sr"].includes(language)
                ? language
                : "other",
              input_mode: turn.inputKind === "transcript" ? "voice" : "text",
              latency_per_stage: {
                ...metrics.stageLatencies,
                total: metrics.latencyMs,
                model: metrics.modelMs,
                tools: metrics.toolMs,
              },
              tool_count: metrics.toolCount,
            },
            consent: true,
            anonymousId: randomUUID(),
          },
          getEnvironment(),
        );
      },
    });
  } catch (error) {
    if (error instanceof SessionRateLimitError)
      return Response.json(
        { error: error.code },
        {
          status: error.status,
          headers: {
            "Retry-After": String(error.retryAfterSeconds),
            "Cache-Control": "private, no-store",
          },
        },
      );
    if (error instanceof SessionUnauthorized || error instanceof TurnError)
      return Response.json({ error: error.code }, { status: error.status });
    if (error instanceof SyntaxError)
      return Response.json({ error: "INVALID_TURN" }, { status: 400 });
    return Response.json({ error: "TURN_FAILED" }, { status: 500 });
  }
}
