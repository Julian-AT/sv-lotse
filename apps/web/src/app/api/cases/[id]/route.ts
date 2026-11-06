import { type CaseRouteParams, caseResponse, dashboardCasesResponse } from "@/server/case-file.ts";

export const runtime = "nodejs";

export async function GET(request: Request, context: CaseRouteParams): Promise<Response> {
  return caseResponse(request, (await context.params).id);
}

export async function PATCH(request: Request, context: CaseRouteParams): Promise<Response> {
  if (new URL(request.url).searchParams.get("view") === "dashboard")
    return dashboardCasesResponse(request, (await context.params).id);
  return caseResponse(request, (await context.params).id);
}

export async function DELETE(request: Request, context: CaseRouteParams): Promise<Response> {
  return dashboardCasesResponse(request, (await context.params).id);
}
