import { inviteResponse } from "@/server/invites.ts";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return inviteResponse(request, "list");
}

export function PATCH(request: Request): Promise<Response> {
  return inviteResponse(request, "control");
}
