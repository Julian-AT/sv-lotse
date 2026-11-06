import { healthDetailsResponse } from "@/server/health-details.ts";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return healthDetailsResponse(request);
}
