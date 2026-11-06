import { type CaseRouteParams, handoffResponse } from "@/server/case-file.ts";

export const runtime = "nodejs";

export async function POST(request: Request, context: CaseRouteParams): Promise<Response> {
  return handoffResponse(request, (await context.params).id);
}

export async function GET(request: Request, context: CaseRouteParams): Promise<Response> {
  return handoffResponse(request, (await context.params).id);
}
