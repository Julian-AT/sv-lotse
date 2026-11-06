import { portabilityResponse } from "@/server/case-file.ts";

export const runtime = "nodejs";

export async function DELETE(request: Request): Promise<Response> {
  return portabilityResponse(request, "delete");
}
