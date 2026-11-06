import { formPackageResponse } from "@/server/form-packages.ts";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context): Promise<Response> {
  return formPackageResponse(request, (await context.params).id);
}
