import { emitAnalytics } from "@/analytics/emit.ts";
import { caseStarted } from "@/analytics/product.ts";
import { casesResponse, dashboardCasesResponse } from "@/server/case-file.ts";
import { casesResponse as workspaceCasesResponse } from "@/server/workspace.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (new URL(request.url).searchParams.get("view") === "dashboard")
    return dashboardCasesResponse(request);
  if (new URL(request.url).searchParams.get("view") === "workspace")
    return workspaceCasesResponse(request);
  return casesResponse(request);
}

export async function POST(request: Request): Promise<Response> {
  const response = await workspaceCasesResponse(request);
  if (response.ok) await emitAnalytics(request, caseStarted());
  return response;
}
