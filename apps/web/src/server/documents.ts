import {
  confirmFactSchema,
  createDocumentService,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_RESPONSE_HEADERS,
  DocumentError,
  DocumentUploadError,
  documentMediaType,
  documentPagesSchema,
  documentUploadId,
  factEditSchema,
  factMutationSchema,
  factQuerySchema,
  readDocumentBody as readUploadBody,
  storeDocumentUpload,
} from "@lotse/brain/documents";
import { z } from "zod";
import { emitAnalytics } from "../analytics/emit.ts";
import { documentImported, factsConfirmed } from "../analytics/product.ts";
import { readDocumentBody, readDocumentJson } from "./document-body.ts";
import { getEnvironment } from "./env.ts";
import { getDatabase, getStorage } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

const headers = DOCUMENT_RESPONSE_HEADERS;
class OriginDenied extends Error {}
async function documentService(request: Request) {
  const identity = await requireSession(request);
  const config = getEnvironment();
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== resolveSessionOrigin(request, config.LOTSE_WORKSPACE_URL)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new OriginDenied();
  return createDocumentService(getDatabase().db, identity.userId, {
    sessionId: identity.sessionId,
    storage: getStorage(),
    encryptionSecret: config.SESSION_SECRET,
    proposalSecret: config.SESSION_SECRET,
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof SessionUnauthorized)
    return Response.json({ error: error.code }, { status: 401, headers });
  if (error instanceof OriginDenied)
    return Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError)
    return Response.json({ error: "INVALID_DOCUMENT_REQUEST" }, { status: 400, headers });
  if (error instanceof DocumentError) {
    const status =
      error.code === "access_denied"
        ? 403
        : error.code === "document_not_ready"
          ? 409
          : error.code === "limits_exceeded"
            ? 413
            : ["invalid_input", "invalid_proposal", "invalid_pdf", "unsupported_file"].includes(
                  error.code,
                )
              ? 400
              : 500;
    return Response.json({ error: error.code }, { status, headers });
  }
  return Response.json({ error: "DOCUMENT_REQUEST_FAILED" }, { status: 500, headers });
}

export async function uploadDocumentResponse(request: Request): Promise<Response> {
  try {
    const service = await documentService(request);
    const form = await new Response(new Uint8Array(await readDocumentBody(request)), {
      headers: request.headers,
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new DocumentError("invalid_input");
    if (file.size > DOCUMENT_MAX_BYTES) throw new DocumentError("limits_exceeded");
    const input = {
      subjectId: z.uuid().parse(form.get("subjectId")),
      type: z
        .string()
        .min(1)
        .max(200)
        .parse(form.get("type") ?? "uploaded_document"),
      originClient: z.enum(["web", "mac"]).parse(form.get("originClient") ?? "web"),
      ...(form.has("pages")
        ? { pages: documentPagesSchema.parse(JSON.parse(z.string().parse(form.get("pages")))) }
        : {}),
    };
    const uploaded = await service.upload(
      new Uint8Array(await file.arrayBuffer()),
      input,
      request.signal,
    );
    await emitAnalytics(
      request,
      documentImported("upload", uploaded.mediaType, uploaded.pageCount),
    );
    return Response.json(uploaded, { status: 201, headers });
  } catch (error) {
    return errorResponse(error);
  }
}

const documentScope = factQuerySchema.omit({ factTypes: true });
export async function extractDocumentResponse(
  request: Request,
  documentId: string,
): Promise<Response> {
  try {
    const service = await documentService(request);
    const input = documentScope
      .extend({
        pageRange: z.strictObject({ from: z.int().positive(), to: z.int().positive() }).optional(),
      })
      .parse(await readDocumentJson(request));
    z.uuid().parse(documentId);
    return Response.json(await service.extract({ ...input, documentId }, request.signal), {
      headers,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function documentResponse(request: Request, documentId: string): Promise<Response> {
  try {
    const service = await documentService(request);
    const scope = documentScope.parse(Object.fromEntries(new URL(request.url).searchParams));
    z.uuid().parse(documentId);
    if (request.method === "DELETE")
      return Response.json(await service.deleteDocument({ ...scope, documentId }), { headers });
    const result = await service.read({ ...scope, documentId });
    return new Response(new Uint8Array(result.bytes), {
      headers: { ...headers, "Content-Type": result.mediaType, "Content-Disposition": "inline" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function factsResponse(request: Request): Promise<Response> {
  try {
    const service = await documentService(request);
    if (request.method === "GET") {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      const input = factQuerySchema.parse({
        ...query,
        ...(query.factTypes ? { factTypes: query.factTypes.split(",") } : {}),
      });
      return Response.json({ facts: await service.listFacts(input) }, { headers });
    }
    const input = await readDocumentJson(request);
    if (request.method === "POST") {
      const confirmation = confirmFactSchema.parse(input);
      const fact = await service.confirmFact(confirmation);
      await emitAnalytics(request, factsConfirmed(fact.type, confirmation.value !== undefined));
      return Response.json({ fact }, { status: 201, headers });
    }
    if (request.method === "PATCH") {
      const fact = await service.editFact(factEditSchema.parse(input));
      await emitAnalytics(request, factsConfirmed(fact.type, true));
      return Response.json({ fact }, { headers });
    }
    return Response.json(await service.deleteFact(factMutationSchema.parse(input)), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function documentUploadResponse(request: Request): Promise<Response> {
  try {
    const identity = await requireSession(request);
    const environment = getEnvironment();
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== resolveSessionOrigin(request, environment.LOTSE_WORKSPACE_URL)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      throw new DocumentUploadError("ORIGIN_NOT_ALLOWED", 403);
    }
    const contentType = documentMediaType.safeParse(request.headers.get("content-type"));
    const uploadId = documentUploadId.safeParse(request.headers.get("idempotency-key"));
    if (!contentType.success || !uploadId.success)
      throw new DocumentUploadError("INVALID_UPLOAD_HEADERS", 400);
    const bytes = await readUploadBody(request);
    const result = await storeDocumentUpload(
      {
        db: getDatabase().db,
        storage: getStorage(),
        encryptionSecret: environment.SESSION_SECRET,
      },
      { userId: identity.userId, uploadId: uploadId.data, contentType: contentType.data, bytes },
    );
    await emitAnalytics(request, documentImported("file", contentType.data, 0));
    return Response.json(result, { status: 201, headers: DOCUMENT_RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof SessionUnauthorized || error instanceof DocumentUploadError) {
      return Response.json(
        { error: error.code },
        { status: error.status, headers: DOCUMENT_RESPONSE_HEADERS },
      );
    }
    return Response.json(
      { error: "DOCUMENT_UPLOAD_FAILED" },
      { status: 503, headers: DOCUMENT_RESPONSE_HEADERS },
    );
  }
}
