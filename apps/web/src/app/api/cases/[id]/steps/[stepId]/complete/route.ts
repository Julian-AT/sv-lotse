import { completeStepResponse } from "@/server/case-file.ts";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; stepId: string }> },
): Promise<Response> {
  const { id, stepId } = await context.params;
  return completeStepResponse(request, id, stepId);
}
