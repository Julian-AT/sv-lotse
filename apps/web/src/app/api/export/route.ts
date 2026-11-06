import { portabilityResponse } from "@/server/case-file.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return portabilityResponse(request, "export");
}
