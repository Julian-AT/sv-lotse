import { formTemplateReviewResponse } from "@/features/form-viewer/review-server.ts";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return formTemplateReviewResponse(request, (await context.params).id);
}
