import { autonomyResponse } from "@/server/autonomy.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return autonomyResponse(request);
}

export async function PATCH(request: Request): Promise<Response> {
  return autonomyResponse(request);
}
