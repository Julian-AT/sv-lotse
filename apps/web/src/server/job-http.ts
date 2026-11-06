import { TurnError } from "@lotse/brain";
import { JobError } from "@lotse/brain/jobs";
import { getEnvironment } from "./env.ts";
import { SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export function assertJobOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new JobError("INVALID_JOB", 403);
}

export function jobHttpError(error: unknown): Response {
  if (
    error instanceof JobError ||
    error instanceof TurnError ||
    error instanceof SessionUnauthorized
  )
    return Response.json({ error: error.code }, { status: error.status, headers: privateHeaders });
  if (error instanceof SyntaxError)
    return Response.json({ error: "INVALID_JOB" }, { status: 400, headers: privateHeaders });
  return Response.json({ error: "REQUEST_FAILED" }, { status: 500, headers: privateHeaders });
}
