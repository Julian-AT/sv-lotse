import { formPdfResponse } from "@/server/forms.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return formPdfResponse(request, (await context.params).id);
}
