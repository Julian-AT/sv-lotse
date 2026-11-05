import { randomUUID } from "node:crypto";
import { createDatabase } from "@lotse/brain/db";
import { migrateDatabase } from "@lotse/brain/db/migrations";
import { sessions, users } from "@lotse/brain/db/schema";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test } from "vitest";
import { loadLocalEnvironment } from "../scripts/load-env.mjs";
import { parseEnvironment, resourceEnvironment } from "../src/server/env.ts";
import {
  createSessionService,
  requireSession,
  SessionUnauthorized,
} from "../src/server/session.ts";
import {
  COOKIE_ROTATION_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  signCookie,
} from "../src/server/session-cookie.ts";

loadLocalEnvironment();
const config = parseEnvironment(process.env);
const admin = createDatabase(resourceEnvironment(config));
const databaseName = `lotse_web_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(config.DATABASE_URL);
url.pathname = `/${databaseName}`;
const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
const service = createSessionService(database.db, config);
let created = false;
function request(cookie?: string) {
  return new NextRequest("http://localhost:3000", {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

beforeAll(async () => {
  await admin.sql`CREATE DATABASE ${admin.sql(databaseName)}`;
  created = true;
  await migrateDatabase(database);
});
afterAll(async () => {
  await database.close();
  if (created) await admin.sql`DROP DATABASE ${admin.sql(databaseName)} WITH (FORCE)`;
  await admin.close();
});

test("AC2 first visit creates exactly one user and session; reload and refresh preserve them", async () => {
  const initial = await service.ensureSession(request());
  expect(initial.cookie).toBeDefined();
  expect(await service.requireSession(request(initial.cookie))).toEqual(initial.identity);
  const refreshed = await service.ensureSession(request(initial.cookie));
  expect(refreshed.identity).toEqual(initial.identity);
  expect(refreshed.cookie).toBeUndefined();
  expect(await database.db.select().from(users)).toHaveLength(1);
  expect(await database.db.select().from(sessions)).toHaveLength(1);
});

test("requireSession returns typed 401 for missing, tampered, unknown and expired sessions", async () => {
  for (const cookie of [undefined, "tampered", signCookie(randomUUID(), config.SESSION_SECRET)]) {
    await expect(service.requireSession(request(cookie))).rejects.toMatchObject({
      status: 401,
      code: "SESSION_REQUIRED",
    });
  }
  // Also exercise the public seam; invalid input never opens a database connection.
  await expect(requireSession(request())).rejects.toBeInstanceOf(SessionUnauthorized);
  const initial = await service.ensureSession(request());
  await expect(
    service.requireSession(request(initial.cookie), Date.now() + SESSION_IDLE_MS + 1000),
  ).rejects.toBeInstanceOf(SessionUnauthorized);
});

test("AC2 tampered cookie creates a new anonymous identity without an error", async () => {
  const initial = await service.ensureSession(request());
  const replacement = await service.ensureSession(request(`${initial.cookie}x`));
  expect(replacement.identity.sessionId).not.toBe(initial.identity.sessionId);
  expect(await service.requireSession(request(replacement.cookie))).toEqual(replacement.identity);
});

test("sessions rotate signatures on schedule and active requests extend idle expiry", async () => {
  const initial = await service.ensureSession(request());
  const later = Date.now() + COOKIE_ROTATION_MS + 1000;
  const rotated = await service.ensureSession(request(initial.cookie), false, later);
  expect(rotated.identity).toEqual(initial.identity);
  expect(rotated.cookie).not.toBe(initial.cookie);
  expect(await service.requireSession(request(rotated.cookie), later + COOKIE_ROTATION_MS)).toEqual(
    initial.identity,
  );
});

test("AC3 reset revokes the old session, preserves its user and creates a fresh identity", async () => {
  const initial = await service.ensureSession(request());
  const reset = await service.ensureSession(request(initial.cookie), true);
  expect(reset.identity.sessionId).not.toBe(initial.identity.sessionId);
  expect(reset.identity.userId).toBe(initial.identity.userId);
  await expect(service.requireSession(request(initial.cookie))).rejects.toBeInstanceOf(
    SessionUnauthorized,
  );
  expect(await service.requireSession(request(reset.cookie))).toEqual(reset.identity);
  expect(
    await database.db.select().from(users).where(eq(users.id, initial.identity.userId)),
  ).toHaveLength(1);
  expect(
    await database.db.select().from(sessions).where(eq(sessions.id, initial.identity.sessionId)),
  ).toHaveLength(1);
});

test("idle sessions cannot be revived by replaying a signed cookie", async () => {
  const initial = await service.ensureSession(request());
  await database.db
    .update(sessions)
    .set({ expiresAt: sql`${sessions.createdAt} + interval '1 microsecond'` })
    .where(eq(sessions.id, initial.identity.sessionId));
  const replacement = await service.ensureSession(request(initial.cookie));
  expect(replacement.identity.sessionId).not.toBe(initial.identity.sessionId);
});

test("session cookie lookup never consumes a POST request body", async () => {
  const initial = await service.ensureSession(request());
  const posted = new NextRequest("http://localhost:3000/api/session", {
    method: "POST",
    body: "unread body",
    headers: { cookie: `${SESSION_COOKIE}=${initial.cookie}` },
  });
  const result = await service.ensureSession(posted);
  expect(result.identity).toEqual(initial.identity);
  expect(posted.bodyUsed).toBe(false);
  expect(await posted.text()).toBe("unread body");
});

test("a request queued before reset cannot revive the revoked session", async () => {
  const initial = await service.ensureSession(request());
  const requestArrivalTime = Date.now();
  await service.ensureSession(request(initial.cookie), true);
  await expect(
    service.requireSession(request(initial.cookie), requestArrivalTime),
  ).rejects.toBeInstanceOf(SessionUnauthorized);
});

test("rotated signatures cannot bypass the database absolute session lifetime", async () => {
  const initial = await service.ensureSession(request());
  await database.db
    .update(sessions)
    .set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
    .where(eq(sessions.id, initial.identity.sessionId));
  await expect(service.requireSession(request(initial.cookie))).rejects.toBeInstanceOf(
    SessionUnauthorized,
  );
});

test("AC2 raw duplicate cookies reject both shadowing orders before Next.js parsing", async () => {
  const visitor = await service.ensureSession(request());
  const attacker = await service.ensureSession(request());
  for (const cookie of [
    `${SESSION_COOKIE}=${visitor.cookie}; ${SESSION_COOKIE}=${attacker.cookie}`,
    `${SESSION_COOKIE}=${attacker.cookie}; ${SESSION_COOKIE}=${visitor.cookie}`,
  ]) {
    const shadowed = new NextRequest("http://localhost:3000", { headers: { cookie } });
    // Next.js has already collapsed duplicates in its cookie map; the raw header
    // remains the only reliable source for rejecting the ambiguous credential.
    expect(shadowed.cookies.getAll(SESSION_COOKIE)).toHaveLength(1);
    await expect(service.requireSession(shadowed)).rejects.toBeInstanceOf(SessionUnauthorized);
    const recovered = await service.ensureSession(shadowed);
    expect(recovered.identity.userId).not.toBe(visitor.identity.userId);
    expect(recovered.identity.userId).not.toBe(attacker.identity.userId);
  }
});

test("AC2 a first public visit ignores a planted signed legacy cookie", async () => {
  const attacker = await service.ensureSession(request());
  const planted = new NextRequest("https://lotse.example", {
    headers: { cookie: `${SESSION_COOKIE}=${attacker.cookie}` },
  });
  await expect(service.requireSession(planted)).rejects.toBeInstanceOf(SessionUnauthorized);
  const visitor = await service.ensureSession(planted);
  expect(visitor.identity.userId).not.toBe(attacker.identity.userId);
  expect(visitor.cookie).toBeDefined();
  expect(
    await service.requireSession(
      new NextRequest("https://lotse.example", {
        headers: { cookie: `__Host-lotse_session=${visitor.cookie}` },
      }),
    ),
  ).toEqual(visitor.identity);
});

test("AC3 concurrent resets retain the old user only for the successful revocation", async () => {
  const initial = await service.ensureSession(request());
  const resets: ReturnType<typeof service.ensureSession>[] = [];
  // A real row lock queues all reset requests before either may replace the
  // session. No database operations or transaction results are simulated.
  await database.sql.begin(async (tx) => {
    await tx`SELECT id FROM session WHERE id = ${initial.identity.sessionId} FOR UPDATE`;
    for (let index = 0; index < 4; index++) {
      resets.push(service.ensureSession(request(initial.cookie), true));
    }
    await expect
      .poll(async () => {
        const [waiting] = await admin.sql`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = ${databaseName} AND wait_event_type = 'Lock'
        `;
        return waiting?.count;
      })
      .toBe(resets.length);
  });
  const replacements = await Promise.all(resets);
  expect(
    replacements.filter((replacement) => replacement.identity.userId === initial.identity.userId),
  ).toHaveLength(1);
  expect(new Set(replacements.map((replacement) => replacement.identity.userId)).size).toBe(
    replacements.length,
  );
  for (const replacement of replacements) {
    expect(await service.requireSession(request(replacement.cookie))).toEqual(replacement.identity);
  }
  await expect(service.requireSession(request(initial.cookie))).rejects.toBeInstanceOf(
    SessionUnauthorized,
  );
  const replay = await service.ensureSession(request(initial.cookie), true);
  expect(replay.identity.userId).not.toBe(initial.identity.userId);
});
