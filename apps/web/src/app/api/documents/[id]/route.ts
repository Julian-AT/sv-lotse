import { documentResponse } from "@/server/documents.ts";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return documentResponse(request, (await context.params).id);
}

export const DELETE = GET;
