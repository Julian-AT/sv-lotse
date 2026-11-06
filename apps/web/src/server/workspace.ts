import {
  appointmentCalendarInput,
  appointmentPreparationInput,
  createWorkspaceService,
  exportAppointmentHold,
  prepareWorkspaceAppointment,
  rehearseWorkspaceAppointment,
  WorkspaceError,
  workspaceQuerySchema,
} from "@lotse/brain/workspace";
import { z } from "zod";
import { CaseQuerySchema } from "../conversation/schemas.ts";
import { getEnvironment } from "./env.ts";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

type WorkspaceService = ReturnType<typeof createWorkspaceService>;
type Handler = (service: WorkspaceService) => Promise<unknown>;

export async function workspaceResponse(
  request: Request,
  handler: Handler | "snapshot" | "prepare" | "rehearse" | "calendar",
): Promise<Response> {
  try {
    const identity = await requireSession(request);
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json(
        { error: "ORIGIN_NOT_ALLOWED" },
        { status: 403, headers: privateHeaders },
      );
    const service = createWorkspaceService(getDatabase().db, identity.userId, identity.sessionId);
    const result =
      typeof handler === "function"
        ? await handler(service)
        : await workspaceOperation(request, service, handler);
    return result instanceof Response ? result : Response.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: 401, headers: privateHeaders });
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: "INVALID_INPUT" }, { status: 400, headers: privateHeaders });
    if (error instanceof WorkspaceError) {
      const status =
        error.code === "ACCESS_DENIED" || error.code === "CASE_ACCESS_DENIED"
          ? 403
          : error.code === "NOT_FOUND" || error.code === "RESOURCE_NOT_FOUND"
            ? 404
            : 400;
      return Response.json({ error: error.code }, { status, headers: privateHeaders });
    }
    return Response.json(
      { error: "WORKSPACE_UNAVAILABLE" },
      { status: 503, headers: privateHeaders },
    );
  }
}

export function casesResponse(request: Request): Promise<Response> {
  return workspaceResponse(request, async (service) =>
    request.method === "POST"
      ? { case: await service.createCase() }
      : { cases: await service.listCases() },
  );
}

export function historyResponse(request: Request): Promise<Response> {
  return workspaceResponse(request, async (service) => ({
    messages: await service.history(
      CaseQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams)).caseId,
    ),
  }));
}

async function workspaceOperation(
  request: Request,
  service: WorkspaceService,
  operation: "snapshot" | "prepare" | "rehearse" | "calendar",
): Promise<Response> {
  if (operation === "snapshot") {
    const query = workspaceQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await service.snapshot(query), { headers: privateHeaders });
  }
  if (operation === "prepare" || operation === "rehearse") {
    const input = appointmentPreparationInput.parse(await request.json());
    const snapshot = await service.snapshot({
      caseId: input.caseId,
      ...(input.benefitId ? { benefitId: input.benefitId } : {}),
    });
    return Response.json(
      operation === "rehearse"
        ? rehearseWorkspaceAppointment(snapshot, input)
        : prepareWorkspaceAppointment(snapshot, input),
      {
        headers: privateHeaders,
      },
    );
  }
  const input = appointmentCalendarInput.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const snapshot = await service.snapshot({ caseId: input.caseId });
  return new Response(exportAppointmentHold(snapshot, input, new Date()), {
    headers: {
      ...privateHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="lotse-appointment.ics"',
    },
  });
}
