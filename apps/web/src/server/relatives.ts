import {
  createInviteSchema,
  createRelativeService,
  createRelativesToken,
  joinInviteSchema,
  RELATIVE_TOKEN_TTL_SECONDS,
  type RelativeIdentity,
  RelativeSessionError,
  RelativesError,
  relativesTokenInput,
  sessionActionSchema,
  sessionIdSchema,
} from "@lotse/brain/relatives";
import { SubjectServiceError } from "@lotse/brain/subjects";
import { AccessToken, RoomServiceClient, ServerError, TrackSource } from "livekit-server-sdk";
import { z } from "zod";
import { analyticsSink } from "../analytics/emit.ts";
import { getEnvironment } from "./env.ts";
import { getDatabase } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

async function relativesRequest(
  request: Request,
  operation: (
    service: ReturnType<typeof createRelativeService>,
    identity: RelativeIdentity,
  ) => Promise<unknown>,
): Promise<Response> {
  try {
    const config = getEnvironment();
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== resolveSessionOrigin(request, config.LOTSE_WORKSPACE_URL)) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    ) {
      return Response.json(
        { error: "ORIGIN_NOT_ALLOWED" },
        { status: 403, headers: privateHeaders },
      );
    }
    const identity = await requireSession(request);
    const service = createRelativeService(
      getDatabase(),
      { userId: identity.userId, sessionId: identity.sessionId },
      { onProductEvent: analyticsSink(request) },
    );
    return Response.json(await operation(service, identity), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json({ error: error.code }, { status: 401, headers: privateHeaders });
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers: privateHeaders });
    if (error instanceof RelativesError)
      return Response.json(
        { error: error.code },
        { status: error.code === "RELATIVES_FORBIDDEN" ? 403 : 503, headers: privateHeaders },
      );
    if (error instanceof RelativeSessionError || error instanceof SubjectServiceError)
      return Response.json({ error: error.code }, { status: 403, headers: privateHeaders });
    return Response.json(
      { error: "RELATIVES_UNAVAILABLE" },
      { status: 503, headers: privateHeaders },
    );
  }
}

function roomService(): RoomServiceClient {
  const config = getEnvironment();
  const url = new URL(config.LIVEKIT_URL);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return new RoomServiceClient(url.toString(), config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
}

async function closeRoom(id: string): Promise<void> {
  try {
    await roomService().deleteRoom(`relative-${id}`);
  } catch (error) {
    if (!(error instanceof ServerError) || error.code !== "not_found") throw error;
  }
}

export function createInviteResponse(request: Request): Promise<Response> {
  return relativesRequest(request, async (service) => {
    const { caseId, shareScope } = createInviteSchema.parse(await request.json());
    return service.createInvite(caseId, shareScope);
  });
}

export function listCasesResponse(request: Request): Promise<Response> {
  return relativesRequest(request, async (service) => ({ cases: await service.listCases() }));
}

export function joinInviteResponse(request: Request): Promise<Response> {
  return relativesRequest(request, async (service) =>
    service.joinInvite(joinInviteSchema.parse(await request.json()).token),
  );
}

export function getRelativeSessionResponse(request: Request): Promise<Response> {
  return relativesRequest(request, async (service) => {
    const { id } = sessionIdSchema.parse({ id: new URL(request.url).searchParams.get("id") });
    const session = await service.getSession(id);
    if (session.state === "ended") await closeRoom(id);
    return session;
  });
}

export function updateRelativeSessionResponse(request: Request): Promise<Response> {
  return relativesRequest(request, async (service) => {
    const { id, action } = sessionActionSchema.parse(await request.json());
    if (action === "approve") return service.approve(id);
    if (action === "pause" || action === "resume") {
      const session = await service.control(id, action);
      if (action === "pause") await closeRoom(id);
      return session;
    }
    const session = await service.end(id);
    await closeRoom(id);
    return session;
  });
}

export async function mintRelativeToken(
  access: { room: string; identity: string; role: "subject" | "helper" },
  config: { LIVEKIT_API_KEY: string; LIVEKIT_API_SECRET: string },
): Promise<string> {
  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: access.identity,
    ttl: RELATIVE_TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    roomJoin: true,
    room: access.room,
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
    canPublishSources:
      access.role === "subject"
        ? [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
        : [TrackSource.MICROPHONE],
  });
  return token.toJwt();
}

export function relativeTokenResponse(request: Request): Promise<Response> {
  return relativesRequest(request, async (service, identity) => {
    const input = z.union([sessionIdSchema, relativesTokenInput]).parse(await request.json());
    if ("caseId" in input)
      return createRelativesToken(getDatabase(), getEnvironment(), identity, input);
    const access = await service.roomAccess(input.id);
    const config = getEnvironment();
    return {
      token: await mintRelativeToken(access, config),
      url: config.LIVEKIT_URL,
      role: access.role,
      peerIdentity: access.peerIdentity,
      expiresAt: access.expiresAt,
    };
  });
}

export const relativesTokenResponse = relativeTokenResponse;

export function listRelativeSessionsResponse(request: Request): Promise<Response> {
  return relativesRequest(request, async (service) => {
    const caseId = z.uuid().parse(new URL(request.url).searchParams.get("caseId"));
    return { sessions: await service.listSessions(caseId) };
  });
}
