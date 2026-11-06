import { documentUploadResponse, uploadDocumentResponse } from "@/server/documents.ts";
import { sharedContextResponse } from "@/server/shared-context.ts";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return sharedContextResponse(request, "documents");
}

export function POST(request: Request): Promise<Response> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "multipart/form-data"
    ? uploadDocumentResponse(request)
    : documentUploadResponse(request);
}
