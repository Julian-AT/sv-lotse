import { type CaseRouteParams, stepResponse } from "@/server/case-file.ts";

export const runtime = "nodejs";

export async function POST(request: Request, context: CaseRouteParams): Promise<Response> {
  return stepResponse(request, (await context.params).id);
}
