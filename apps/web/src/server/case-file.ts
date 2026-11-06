import {
  CaseFileError,
  createCaseDashboardService,
  createCaseFileService,
  createHandoffService,
  createPortabilityService,
} from "@lotse/brain/case-file";
import { z } from "zod";
import { emitAnalytics } from "../analytics/emit.ts";
import { handoffCreated } from "../analytics/product.ts";
import { getEnvironment } from "./env.ts";
import { getDatabase, getStorage } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export type CaseRouteParams = { params: Promise<{ id: string }> };

async function protect(request: Request) {
  const identity = await requireSession(request);
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const expected = resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL);
    if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site")
      throw new CaseFileError("access_denied");
  }
  return identity;
}

async function respond(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json(
        { error: error.code },
        { status: error.status, headers: privateHeaders },
      );
    if (error instanceof CaseFileError) {
      const status = {
        invalid_input: 400,
        access_denied: 403,
        not_found: 404,
        operation_failed: 500,
        case_busy: 409,
      }[error.code];
      return Response.json(
        { error: `CASE_${error.code.toUpperCase()}` },
        { status, headers: privateHeaders },
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json(
        { error: "INVALID_CASE_INPUT" },
        { status: 400, headers: privateHeaders },
      );
    return Response.json(
      { error: "CASE_OPERATION_FAILED" },
      { status: 500, headers: privateHeaders },
    );
  }
}

export function casesResponse(request: Request): Promise<Response> {
  return respond(async () => {
    const identity = await protect(request);
    return Response.json(
      await createCaseFileService(getDatabase().db, identity.userId, identity.sessionId).list(),
      {
        headers: privateHeaders,
      },
    );
  });
}

export function dashboardCasesResponse(request: Request, caseId?: string): Promise<Response> {
  return respond(async () => {
    const identity = await protect(request);
    const service = createCaseDashboardService(getDatabase().db, identity.userId);
    if (caseId && request.method === "DELETE") {
      await service.delete(caseId, getStorage());
      return new Response(null, { status: 204, headers: privateHeaders });
    }
    if (caseId && request.method === "PATCH") {
      await service.rename(caseId, await request.json());
      return new Response(null, { status: 204, headers: privateHeaders });
    }
    return Response.json({ cases: await service.list() }, { headers: privateHeaders });
  });
}

export function caseResponse(
  request: Request,
  caseId: string,
  action: "case" | "history" | "replay" = "case",
): Promise<Response> {
  return respond(async () => {
    const identity = await protect(request);
    const service = createCaseFileService(getDatabase().db, identity.userId, identity.sessionId);
    if (request.method === "PATCH")
      return Response.json(await service.update(caseId, await request.json()), {
        headers: privateHeaders,
      });
    if (action !== "case") {
      const history = await service.history(caseId);
      return Response.json(
        action === "replay"
          ? {
              caseId,
              replay: true,
              messages: history.messages.map((row) => row.uiMessage),
              events: history.entries,
            }
          : history,
        { headers: privateHeaders },
      );
    }
    return Response.json(await service.get(caseId), { headers: privateHeaders });
  });
}

export function stepResponse(request: Request, caseId: string, stepId?: string): Promise<Response> {
  return respond(async () => {
    const identity = await protect(request);
    const result = await createCaseFileService(
      getDatabase().db,
      identity.userId,
      identity.sessionId,
    ).saveStep(caseId, await request.json(), stepId);
    return Response.json(result, { status: stepId ? 200 : 201, headers: privateHeaders });
  });
}

export function completeStepResponse(
  request: Request,
  caseId: string,
  stepId: string,
): Promise<Response> {
  return respond(async () => {
    const identity = await protect(request);
    const text = await request.text();
    const input = z
      .strictObject({ evidence: z.record(z.string(), z.json()).optional() })
      .parse(text.trim() ? JSON.parse(text) : {});
    const result = await createCaseFileService(getDatabase().db, identity.userId).saveStep(
      caseId,
      { status: "completed" },
      stepId,
      input.evidence,
    );
    return Response.json(result, { headers: privateHeaders });
  });
}

export function handoffResponse(request: Request, caseId: string): Promise<Response> {
  return respond(async () => {
    const identity = await protect(request);
    const service = createHandoffService(getDatabase().db, getStorage(), identity.userId);
    if (request.method === "GET") {
      const { documentKey } = z
        .strictObject({ documentKey: z.uuid() })
        .parse(Object.fromEntries(new URL(request.url).searchParams));
      const bytes = await service.download(caseId, documentKey);
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...privateHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="lotse-case-summary.pdf"',
        },
      });
    }
    const body = await request.text();
    const input = z
      .strictObject({ scope: z.array(z.string()).optional() })
      .parse(body.trim() ? JSON.parse(body) : {});
    const result = await service.compose(caseId, input.scope);
    await emitAnalytics(request, handoffCreated());
    return Response.json(
      { ...result, downloadUrl: `/api/cases/${caseId}/handoff?documentKey=${result.documentKey}` },
      { status: 201, headers: privateHeaders },
    );
  });
}

export function portabilityResponse(
  request: Request,
  action: "export" | "delete",
): Promise<Response> {
  return respond(async () => {
    const identity = await protect(request);
    const inputSchema = z.strictObject({ subjectId: z.uuid().optional() });
    const query = inputSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const text = request.method === "GET" ? "" : await request.text();
    const body = inputSchema.parse(text.trim() ? JSON.parse(text) : {});
    if (query.subjectId && body.subjectId && query.subjectId !== body.subjectId)
      throw new CaseFileError("invalid_input");
    const subjectId = query.subjectId ?? body.subjectId;
    const service = createPortabilityService(getDatabase().db, getStorage(), identity.userId);
    if (action === "delete")
      return Response.json(await service.delete(subjectId), { headers: privateHeaders });
    const bytes = await service.export(subjectId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="lotse-data.zip"',
      },
    });
  });
}
