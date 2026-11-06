import { extractDocumentResponse } from "@/server/documents.ts";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return extractDocumentResponse(request, (await context.params).id);
}
