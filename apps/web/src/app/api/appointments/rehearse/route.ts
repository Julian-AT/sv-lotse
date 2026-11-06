import { workspaceResponse } from "@/server/workspace.ts";

export const runtime = "nodejs";
export function POST(request: Request): Promise<Response> {
  return workspaceResponse(request, "rehearse");
}
