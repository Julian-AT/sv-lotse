import { stepResponse } from "@/server/case-file.ts";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; stepId: string }> },
): Promise<Response> {
  const { id, stepId } = await context.params;
  return stepResponse(request, id, stepId);
}
