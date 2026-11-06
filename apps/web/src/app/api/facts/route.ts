import { factsResponse } from "@/server/documents.ts";
import { sharedContextResponse } from "@/server/shared-context.ts";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return new URL(request.url).searchParams.has("actorId")
    ? sharedContextResponse(request, "facts")
    : factsResponse(request);
}

export const POST = factsResponse;
export const PATCH = factsResponse;
export const DELETE = factsResponse;
