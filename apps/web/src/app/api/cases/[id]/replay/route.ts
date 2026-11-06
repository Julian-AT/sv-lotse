import { type CaseRouteParams, caseResponse } from "@/server/case-file.ts";

export const runtime = "nodejs";

export async function GET(request: Request, context: CaseRouteParams): Promise<Response> {
  return caseResponse(request, (await context.params).id, "replay");
}
