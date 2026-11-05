import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/brain/db";
import { sessions, users } from "@lotse/brain/db/schema";
import { updateProfileSettings } from "@lotse/brain/language";
import { and, eq, gt, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEnvironment, type ServerEnvironment } from "./env.ts";
import { getDatabase } from "./resources.ts";
import {
  COOKIE_LIFETIME_MS,
  COOKIE_ROTATION_MS,
  cookieOptions,
  SESSION_IDLE_MS,
  sessionCookieName,
  signCookie,
  verifyCookie,
} from "./session-cookie.ts";
import { resolveSessionOrigin } from "./session-origin.ts";

export type SessionIdentity = { userId: string; sessionId: string; kind: "anonymous" };
export class SessionUnauthorized extends Error {
  readonly status = 401;
  readonly code = "SESSION_REQUIRED";
  constructor() {
    super("A valid session is required");
    this.name = "SessionUnauthorized";
  }
}

export function createSessionService(db: DatabaseClient, config: ServerEnvironment) {
  function readCookie(request: Request, now: number) {
    const name = sessionCookieName(config.LOTSE_WORKSPACE_URL, request);
    // Next.js collapses duplicate names into a map. Reject ambiguity in the raw
    // header before parsing, regardless of cookie ordering or signature validity.
    const matches = (request.headers.get("cookie") ?? "")
      .split(";")
      .filter((part) => part.split("=", 1)[0]?.trim() === name);
    if (matches.length !== 1) return null;
    const cookies = new NextRequest(request.url, { headers: request.headers }).cookies;
    return verifyCookie(cookies.get(name)?.value, config.SESSION_SECRET, now);
  }

  async function requireSession(request: Request, now = Date.now()): Promise<SessionIdentity> {
    const cookie = readCookie(request, now);
    if (!cookie) throw new SessionUnauthorized();
    return db.transaction(async (tx) => {
      // The conditional update locks the session: a concurrent reset cannot revive it.
      const [session] = await tx
        .update(sessions)
        .set({
          expiresAt: sql`least(${new Date(now + SESSION_IDLE_MS).toISOString()}::timestamptz, ${sessions.createdAt} + interval '30 days')`,
        })
        .where(
          and(
            eq(sessions.id, cookie.sessionId),
            gt(sessions.expiresAt, new Date(now)),
            // Rechecked after a row-lock wait; arrival time alone can revive a reset session.
            gt(sessions.expiresAt, sql`clock_timestamp()`),
            gt(sessions.createdAt, new Date(now - COOKIE_LIFETIME_MS)),
          ),
        )
        .returning();
      if (!session) throw new SessionUnauthorized();
      const [user] = await tx
        .update(users)
        .set({ lastSeenAt: new Date(now) })
        .where(eq(users.id, session.userId))
        .returning();
      if (!user) throw new SessionUnauthorized();
      return { userId: user.id, sessionId: session.id, kind: user.kind };
    });
  }

  async function createSession(now: number, previous?: SessionIdentity): Promise<SessionIdentity> {
    return db.transaction(async (tx) => {
      let retainedUserId: string | undefined;
      if (previous) {
        // Authorization may have preceded another reset. Retain context only if
        // this transaction wins revocation, under the session's row lock.
        const [revoked] = await tx
          .update(sessions)
          .set({
            expiresAt: sql`greatest(${sessions.createdAt} + interval '1 microsecond', clock_timestamp())`,
          })
          .where(
            and(
              eq(sessions.id, previous.sessionId),
              gt(sessions.expiresAt, new Date(now)),
              gt(sessions.expiresAt, sql`clock_timestamp()`),
              gt(sessions.createdAt, new Date(now - COOKIE_LIFETIME_MS)),
            ),
          )
          .returning({ userId: sessions.userId });
        retainedUserId = revoked?.userId;
      }
      const userId = retainedUserId ?? randomUUID();
      const sessionId = randomUUID();
      if (!retainedUserId) await tx.insert(users).values({ id: userId, kind: "anonymous" });
      await tx.insert(sessions).values({
        id: sessionId,
        userId,
        clientKind: "web",
        expiresAt: new Date(now + SESSION_IDLE_MS),
      });
      return { userId, sessionId, kind: "anonymous" };
    });
  }

  async function ensureSession(request: Request, reset = false, now = Date.now()) {
    let identity: SessionIdentity | undefined;
    try {
      identity = await requireSession(request, now);
    } catch (error) {
      if (!(error instanceof SessionUnauthorized)) throw error;
    }
    const existing = identity;
    if (!identity || reset) identity = await createSession(now, reset ? existing : undefined);
    const cookie = readCookie(request, now);
    const rotated = !existing || reset || !cookie || now - cookie.issuedAt >= COOKIE_ROTATION_MS;
    return {
      identity,
      cookie: rotated ? signCookie(identity.sessionId, config.SESSION_SECRET, now) : undefined,
    };
  }

  return { requireSession, ensureSession };
}

function service() {
  return createSessionService(getDatabase().db, getEnvironment());
}

export function requireSession(request: Request): Promise<SessionIdentity> {
  return service().requireSession(request);
}

export async function pageSession(request: NextRequest): Promise<NextResponse> {
  const result = await service().ensureSession(request);
  const requestedLocale = z
    .enum(["de", "en", "de-simple"])
    .safeParse(request.nextUrl.searchParams.get("lang"));
  if (requestedLocale.success)
    await updateProfileSettings(getDatabase().db, result.identity.userId, {
      language: requestedLocale.data === "en" ? "en" : "de",
      simpleLanguage: requestedLocale.data === "de-simple",
    });
  const cookieName = sessionCookieName(getEnvironment().LOTSE_WORKSPACE_URL, request);
  const headers = new Headers(request.headers);
  if (result.cookie) {
    // Forward the freshly signed cookie so downstream server components see it too.
    request.cookies.set(cookieName, result.cookie);
    headers.set("cookie", request.cookies.toString());
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Cache-Control", "private, no-store");
  if (result.cookie)
    response.cookies.set(
      cookieName,
      result.cookie,
      cookieOptions(getEnvironment().LOTSE_WORKSPACE_URL, request),
    );
  return response;
}

export async function sessionResponse(request: NextRequest, reset = false): Promise<NextResponse> {
  // Reject browser cross-origin writes, including requests from sibling subdomains.
  const origin = request.headers.get("origin");
  const expectedOrigin = resolveSessionOrigin(request, getEnvironment().LOTSE_WORKSPACE_URL);
  if (
    (origin && origin !== expectedOrigin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return NextResponse.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 });
  }
  const result = await service().ensureSession(request, reset);
  const response = NextResponse.json(result.identity, {
    headers: { "Cache-Control": "private, no-store" },
  });
  if (result.cookie)
    response.cookies.set(
      sessionCookieName(getEnvironment().LOTSE_WORKSPACE_URL, request),
      result.cookie,
      cookieOptions(getEnvironment().LOTSE_WORKSPACE_URL, request),
    );
  return response;
}
