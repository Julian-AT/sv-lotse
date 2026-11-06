import { randomUUID } from "node:crypto";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test } from "vitest";
import { loadLocalEnvironment } from "../scripts/load-env.mjs";
import { GET as getConsent, POST as setConsent } from "../src/app/api/analytics/consent/route.ts";
import { POST as capture } from "../src/app/api/analytics/route.ts";
import { getEnvironment } from "../src/server/env.ts";
import { getDatabase } from "../src/server/resources.ts";
import { createSessionService } from "../src/server/session.ts";
import { SESSION_COOKIE } from "../src/server/session-cookie.ts";

loadLocalEnvironment();
const admin = createDatabase();
const databaseName = `lotse_analytics_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(admin.config.DATABASE_URL);
databaseUrl.pathname = `/${databaseName}`;
process.env.DATABASE_URL = databaseUrl.toString();
process.env.LOTSE_WORKSPACE_URL = "http://localhost:3000";
// This acceptance test proves the no-key path even on a developer machine with keys.
delete process.env.POSTHOG_KEY;
const database = createDatabase();
let cookie = "";
let created = false;
beforeAll(async () => {
  await admin.sql`CREATE DATABASE ${admin.sql(databaseName)}`;
  created = true;
  await migrateDatabase(database);
  const session = await createSessionService(database.db, getEnvironment()).ensureSession(
    new NextRequest("http://localhost:3000"),
  );
  cookie = `${SESSION_COOKIE}=${session.cookie}`;
});
afterAll(async () => {
  await getDatabase().close();
  await database.close();
  if (created) await admin.sql`DROP DATABASE ${admin.sql(databaseName)} WITH (FORCE)`;
  await admin.close();
});

function request(body?: unknown, origin = "http://localhost:3000", consentCookie = ""): Request {
  return new Request("http://localhost:3000/api/analytics", {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: `${cookie}${consentCookie}`, origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test("section 15 consent defaults off and explicit preference changes use an HttpOnly cookie", async () => {
  expect(await (await getConsent(request())).json()).toEqual({ consent: false });
  const enabled = await setConsent(request({ consent: true }));
  expect(enabled.status).toBe(200);
  expect(enabled.headers.get("set-cookie")).toContain("lotse_analytics_enabled=1");
  expect(enabled.headers.get("set-cookie")).toContain("HttpOnly");
  expect(enabled.headers.get("set-cookie")).toContain("SameSite=strict");
  expect(
    await (await getConsent(request(undefined, undefined, "; lotse_analytics_enabled=1"))).json(),
  ).toEqual({ consent: true });
  expect((await setConsent(request({ consent: false }))).headers.get("set-cookie")).toContain(
    "lotse_analytics_enabled=0",
  );
});
test("analytics APIs reject unsigned callers, cross-origin changes and extra consent values", async () => {
  expect(
    (await getConsent(new Request("http://localhost:3000/api/analytics/consent"))).status,
  ).toBe(401);
  expect((await setConsent(request({ consent: true }, "https://foreign.example"))).status).toBe(
    403,
  );
  expect((await setConsent(request({ consent: true, text: "private" }))).status).toBe(400);
  expect((await capture(request({}, "https://foreign.example"))).status).toBe(403);
});
test("analytics remains disabled with real sessions and consent when no project key is configured", async () => {
  expect((await capture(request({}, undefined, "; lotse_analytics_enabled=1"))).status).toBe(204);
});
