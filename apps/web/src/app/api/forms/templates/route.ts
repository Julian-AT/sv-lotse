import { formTemplatesResponse } from "@/server/form-templates.ts";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  return formTemplatesResponse(request);
}
export async function POST(request: Request): Promise<Response> {
  return formTemplatesResponse(request);
}
