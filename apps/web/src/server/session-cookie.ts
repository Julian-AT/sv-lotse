import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isVerifiedLoopback } from "./session-origin.ts";

export const SESSION_COOKIE = "lotse_session";
export const SECURE_SESSION_COOKIE = "__Host-lotse_session";
export const COOKIE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const COOKIE_ROTATION_MS = 15 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const cookiePayload = z
  .object({ v: z.literal(1), sessionId: z.uuid(), issuedAt: z.number().int().nonnegative() })
  .strict();

function signature(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${SESSION_COOKIE}:v1:${body}`).digest();
}

export function signCookie(sessionId: string, secret: string, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify(cookiePayload.parse({ v: 1, sessionId, issuedAt: now })),
  ).toString("base64url");
  return `${body}.${signature(body, secret).toString("base64url")}`;
}

export function verifyCookie(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): z.infer<typeof cookiePayload> | null {
  if (!value || value.length > 1024 || !/^[\w-]+\.[\w-]+$/.test(value)) return null;
  const [body, encodedSignature] = value.split(".");
  if (!body || !encodedSignature) return null;
  const supplied = Buffer.from(encodedSignature, "base64url");
  const expected = signature(body, secret);
  if (
    supplied.length !== expected.length ||
    supplied.toString("base64url") !== encodedSignature ||
    !timingSafeEqual(supplied, expected)
  )
    return null;
  try {
    const result = cookiePayload.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    if (
      !result.success ||
      result.data.issuedAt > now ||
      now - result.data.issuedAt >= COOKIE_LIFETIME_MS
    )
      return null;
    return result.data;
  } catch {
    return null;
  }
}

export function cookieOptions(workspaceUrl: string, request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !isVerifiedLoopback(request, workspaceUrl),
    path: "/",
    maxAge: COOKIE_LIFETIME_MS / 1000,
  };
}

export function sessionCookieName(workspaceUrl: string, request: Request): string {
  return isVerifiedLoopback(request, workspaceUrl) ? SESSION_COOKIE : SECURE_SESSION_COOKIE;
}
