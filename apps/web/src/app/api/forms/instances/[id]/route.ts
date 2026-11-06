import { formViewerResponse } from "@/server/form-viewer.ts";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context): Promise<Response> {
  return formViewerResponse(request, (await context.params).id, "instance");
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return formViewerResponse(request, (await context.params).id, "instance");
}
