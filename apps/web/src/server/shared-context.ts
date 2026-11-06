import { createSubjectService, SubjectServiceError } from "@lotse/brain/subjects";
import { z } from "zod";
import { getDatabase, getStorage } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";

/** All read paths use a persisted actor scoped to this subject; never merge access across cases. */
export async function sharedContextResponse(
  request: Request,
  kind: "facts" | "documents",
): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const identity = await requireSession(request);
    const documentQuery = { documentId: z.uuid().optional(), metadata: z.literal("1").optional() };
    const query = z
      .union([
        z.strictObject({ actorId: z.uuid(), subjectId: z.uuid(), ...documentQuery }),
        z.strictObject({ caseId: z.uuid(), ...documentQuery }),
      ])
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const service = createSubjectService(getDatabase(), identity.userId, identity.sessionId);
    if (kind === "facts") {
      if (!("actorId" in query))
        return Response.json({ error: "INVALID_CONTEXT_QUERY" }, { status: 400, headers });
      return Response.json(
        { facts: await service.factsVisibleTo(query.actorId, query.subjectId) },
        { headers },
      );
    }
    const visible =
      "caseId" in query
        ? await service.documentsVisibleInCase(query.caseId)
        : await service.documentsVisibleTo(query.actorId, query.subjectId);
    if (!query.documentId)
      return Response.json(
        { documents: visible.map(({ storageKey: _key, ...document }) => document) },
        { headers },
      );
    const document = visible.find((entry) => entry.id === query.documentId);
    if (!document) return Response.json({ error: "DOCUMENT_NOT_FOUND" }, { status: 404, headers });
    if (query.metadata) {
      const { storageKey: _key, ...metadata } = document;
      return Response.json(metadata, { headers });
    }
    const content = await getStorage().get(document.storageKey);
    return new Response(new Uint8Array(content), {
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="document"',
      },
    });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof SubjectServiceError && error.code === "forbidden")
      return Response.json({ error: "CONTEXT_ACCESS_DENIED" }, { status: 403, headers });
    if (
      error instanceof z.ZodError ||
      (error instanceof SubjectServiceError && error.code === "invalid_input")
    )
      return Response.json({ error: "INVALID_CONTEXT_QUERY" }, { status: 400, headers });
    return Response.json({ error: "CONTEXT_READ_FAILED" }, { status: 500, headers });
  }
}
