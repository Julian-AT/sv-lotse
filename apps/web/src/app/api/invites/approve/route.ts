import { inviteResponse } from "@/server/invites.ts";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return inviteResponse(request, "approve");
}
