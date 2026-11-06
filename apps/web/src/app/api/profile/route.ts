import { profileResponse } from "@/server/profile.ts";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return profileResponse(request);
}

export async function PATCH(request: Request): Promise<Response> {
  return profileResponse(request);
}
