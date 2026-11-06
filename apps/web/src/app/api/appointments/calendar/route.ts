import { workspaceResponse } from "@/server/workspace.ts";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return workspaceResponse(request, "calendar");
}
