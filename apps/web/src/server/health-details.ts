import { parseBrainConfig } from "@lotse/brain/config";
import { createPreferencesService } from "@lotse/brain/preferences";
import { selectVoice, voiceConfiguration } from "@lotse/brain/voice";
import { RoomServiceClient } from "livekit-server-sdk";
import { SETTINGS_CONFIG } from "../config.ts";
import {
  type Connection,
  connectionSchema,
  type HealthDetails,
  type ServiceId,
  serviceIdSchema,
} from "../features/settings/health-schema.ts";
import { getEnvironment } from "./env.ts";
import { getDatabase, getStorage } from "./resources.ts";
import { requireSession, SessionUnauthorized } from "./session.ts";

type Probe = (() => Promise<unknown>) | undefined;
export type HealthProbes = Record<ServiceId, Probe>;
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

async function probe(id: ServiceId, operation: Probe): Promise<Connection> {
  if (!operation) return { id, status: "missing", reason: "not_configured" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("HEALTH_TIMEOUT")),
          SETTINGS_CONFIG.healthTimeoutMs,
        );
      }),
    ]);
    const active =
      id === "elevenlabs" ? connectionSchema.shape.activeVoices.safeParse(result) : undefined;
    return {
      id,
      status: "verified",
      reason: "ok",
      ...(active?.success && active.data ? { activeVoices: active.data } : {}),
    };
  } catch {
    return { id, status: "missing", reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealthDetails(probes: HealthProbes): Promise<HealthDetails> {
  const connections = await Promise.all(serviceIdSchema.options.map((id) => probe(id, probes[id])));
  return { checkedAt: new Date().toISOString(), connections };
}

async function providerCheck(url: string, headers: Record<string, string>): Promise<Response> {
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(SETTINGS_CONFIG.healthTimeoutMs),
    redirect: "error",
  });
  if (!response.ok) throw new Error("PROVIDER_UNAVAILABLE");
  return response;
}

function liveProbes(userId: string): HealthProbes {
  const config = getEnvironment();
  const key = config.OPENAI_API_KEY;
  const voiceKey = config.ELEVENLABS_API_KEY;
  const roomUrl = new URL(config.LIVEKIT_URL);
  roomUrl.protocol = roomUrl.protocol === "wss:" ? "https:" : "http:";
  return {
    brain: () => {
      parseBrainConfig(process.env);
      return createPreferencesService(getDatabase().db, userId).read();
    },
    database: () => getDatabase().sql`select 1`,
    storage: () => getStorage().headBucket(),
    openai: key
      ? () =>
          providerCheck(
            process.env.OPENAI_BASE_URL
              ? `${process.env.OPENAI_BASE_URL.replace(/\/+$/, "")}/models`
              : SETTINGS_CONFIG.openaiModelsUrl,
            { Authorization: `Bearer ${key}` },
          )
      : undefined,
    elevenlabs: voiceKey
      ? async () => {
          // Lists the account voices (cached 10 min) and resolves a usable voice per language,
          // falling back to the best account voice when a configured id does not exist.
          await providerCheck(SETTINGS_CONFIG.elevenlabsVoicesUrl, { "xi-api-key": voiceKey });
          const voice = voiceConfiguration({ ...process.env, ...config });
          const [de, en] = await Promise.all([
            selectVoice("de", voice, fetch, AbortSignal.timeout(SETTINGS_CONFIG.healthTimeoutMs)),
            selectVoice("en", voice, fetch, AbortSignal.timeout(SETTINGS_CONFIG.healthTimeoutMs)),
          ]);
          if (!de || !en) throw new Error("VOICE_UNAVAILABLE");
          return { de, en };
        }
      : undefined,
    livekit: () =>
      new RoomServiceClient(
        roomUrl.toString(),
        config.LIVEKIT_API_KEY,
        config.LIVEKIT_API_SECRET,
      ).listRooms(),
  };
}

export async function healthDetailsResponse(request: Request): Promise<Response> {
  try {
    const identity = await requireSession(request);
    return Response.json(await checkHealthDetails(liveProbes(identity.userId)), {
      headers: privateHeaders,
    });
  } catch (error) {
    if (error instanceof SessionUnauthorized)
      return Response.json(
        { error: error.code },
        { status: error.status, headers: privateHeaders },
      );
    return Response.json(
      { error: "HEALTH_DETAILS_UNAVAILABLE" },
      { status: 503, headers: privateHeaders },
    );
  }
}
