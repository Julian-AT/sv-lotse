import AxeBuilder from "@axe-core/playwright";
import { createDatabase } from "@lotse/brain/db";
import { sessions, users } from "@lotse/brain/db/schema";
import { expect, test } from "@playwright/test";
import { count, eq } from "drizzle-orm";
import { SESSION_COOKIE, verifyCookie } from "../src/server/session-cookie.ts";
import { E2E_BASE_URL, E2E_HEALTH_PORT, E2E_HEALTH_URL } from "./config.ts";

const database = createDatabase();
test.afterAll(async () => {
  await database.close();
});

test("@smoke AC2 first visit creates exactly one user and session; reload preserves identity", async ({
  page,
  context,
}) => {
  const beforeUsers = await database.db.select({ count: count() }).from(users);
  const beforeSessions = await database.db.select({ count: count() }).from(sessions);
  await page.goto("/");
  const cookie = (await context.cookies()).find((item) => item.name === SESSION_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", secure: false });
  const payload = verifyCookie(cookie?.value, process.env.SESSION_SECRET ?? "");
  expect(payload).not.toBeNull();
  const current = await context.request.post("/api/session");
  const identity = await current.json();
  expect(identity.sessionId).toBe(payload?.sessionId);
  await page.reload();
  const refreshed = await context.request.post("/api/session");
  expect(await refreshed.json()).toEqual(identity);
  expect(await database.db.select({ count: count() }).from(users)).toEqual([
    { count: (beforeUsers[0]?.count ?? 0) + 1 },
  ]);
  expect(await database.db.select({ count: count() }).from(sessions)).toEqual([
    { count: (beforeSessions[0]?.count ?? 0) + 1 },
  ]);
});

test("@smoke AC2 tampered cookie recovers with a new session and no error page", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const cookie = (await context.cookies()).find((item) => item.name === SESSION_COOKIE);
  if (!cookie) throw new Error("Session cookie missing");
  await context.addCookies([{ ...cookie, value: `${cookie.value}tampered` }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const replacement = (await context.cookies()).find((item) => item.name === SESSION_COOKIE);
  expect(verifyCookie(replacement?.value, process.env.SESSION_SECRET ?? "")?.sessionId).not.toBe(
    verifyCookie(cookie.value, process.env.SESSION_SECRET ?? "")?.sessionId,
  );
});

test("@smoke AC3 Neue Sitzung revokes the old cookie and preserves the new session on reload", async ({
  page,
  context,
  playwright,
}) => {
  await page.goto("/");
  const oldCookie = (await context.cookies()).find((item) => item.name === SESSION_COOKIE);
  const oldResponse = await context.request.post("/api/session");
  const oldIdentity = await oldResponse.json();
  await page.getByText("Einstellungen", { exact: true }).click();
  await page.getByRole("button", { name: "Neue Sitzung", exact: true }).click();
  await expect(page.locator("header").getByRole("status")).toHaveText("Neue Sitzung gestartet.");
  const response = await context.request.post("/api/session");
  const identity = await response.json();
  expect(identity.sessionId).not.toBe(oldIdentity.sessionId);
  const [oldSession] = await database.db
    .select()
    .from(sessions)
    .where(eq(sessions.id, oldIdentity.sessionId));
  expect(oldSession?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  await page.reload();
  expect(await (await context.request.post("/api/session")).json()).toEqual(identity);
  const replay = await playwright.request.newContext();
  try {
    const rejected = await replay.post(`${E2E_BASE_URL}/api/session`, {
      headers: { cookie: `${SESSION_COOKIE}=${oldCookie?.value}` },
    });
    expect((await rejected.json()).sessionId).not.toBe(oldIdentity.sessionId);
  } finally {
    await replay.dispose();
  }
});

test("@smoke AC5 home and settings have no axe WCAG 2.2 AA violations in either language", async ({
  page,
}) => {
  for (const language of ["de", "en"]) {
    await page.goto(`/?lang=${language}`);
    await expect(page.locator("html")).toHaveAttribute("lang", language === "de" ? "de-AT" : "en");
    await page.locator("header summary").click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});

for (const route of [
  "/workspace",
  "/cases",
  "/journey",
  "/documents",
  "/offers",
  "/appointments",
  "/guided",
  "/setup-guide",
]) {
  test(`@smoke FR-L4 ${route} has no axe WCAG 2.2 AA violations in either language`, async ({
    page,
  }) => {
    for (const language of ["de", "en"]) {
      await page.goto(`${route}?lang=${language}`);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, `${route} (${language})`).toEqual([]);
    }
  });
}

test("@smoke NFR-6 skip link supports keyboard navigation and narrow viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Zum Inhalt" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("@smoke AC1 health is public and reports both real services up", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    dependencies: { database: "up", objectStorage: "up" },
  });
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

test("@smoke session writes reject cross-origin requests", async ({ request }) => {
  const response = await request.delete("/api/session", {
    headers: { origin: "https://foreign.example" },
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

test("@smoke production public origin issues Secure cookies and resets with no workspace URL configured", async ({
  request,
}) => {
  // The standalone Node server sees the same Host and TLS signal as behind an HTTPS reverse proxy.
  const headers = {
    host: "lotse.example",
    "x-forwarded-proto": "https",
    origin: "https://lotse.example",
  };
  const page = await request.get("/", { headers });
  expect(page.status()).toBe(200);
  const cookie = page.headers()["set-cookie"];
  expect(cookie).toMatch(/^__Host-lotse_session=/);
  expect(cookie).toMatch(/; Secure(?:;|$)/);
  expect(cookie).toMatch(/; Path=\/(?:;|$)/);
  expect(cookie).not.toMatch(/; Domain=/i);

  const created = await request.post("/api/session", {
    headers: { ...headers, cookie: cookie?.split(";")[0] ?? "" },
  });
  expect(created.status()).toBe(200);
  expect(created.headers()["set-cookie"]).toBeUndefined();
  const previous = await created.json();
  const reset = await request.delete("/api/session", {
    headers: { ...headers, cookie: cookie?.split(";")[0] ?? "" },
  });
  expect(reset.status()).toBe(200);
  expect(reset.headers()["set-cookie"]).toMatch(/; Secure(?:;|$)/);
  expect((await reset.json()).sessionId).not.toBe(previous.sessionId);
  const [ended] = await database.db
    .select()
    .from(sessions)
    .where(eq(sessions.id, previous.sessionId));
  expect(ended?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  const rejected = await request.delete("/api/session", {
    headers: { ...headers, origin: "https://foreign.example" },
  });
  expect(rejected.status()).toBe(403);
});

test("@smoke AC2 public first visit cannot be fixed onto a planted legacy session", async ({
  request,
}) => {
  const attacker = await request.post("/api/session");
  const attackerIdentity = await attacker.json();
  const planted = attacker.headers()["set-cookie"]?.split(";")[0] ?? "";
  expect(planted).toMatch(/^lotse_session=/);
  const headers = {
    host: "lotse.example",
    "x-forwarded-proto": "https",
    cookie: planted,
  };
  const firstVisit = await request.get("/", { headers });
  expect(firstVisit.status()).toBe(200);
  const protectedCookie = firstVisit.headers()["set-cookie"]?.split(";")[0] ?? "";
  expect(protectedCookie).toMatch(/^__Host-lotse_session=/);
  const visitor = await request.post("/api/session", {
    headers: { ...headers, cookie: `${planted}; ${protectedCookie}` },
  });
  const visitorIdentity = await visitor.json();
  expect(visitorIdentity.userId).not.toBe(attackerIdentity.userId);
  expect(visitorIdentity.sessionId).not.toBe(attackerIdentity.sessionId);
  expect(visitor.headers()["set-cookie"]).toBeUndefined();
});

test("@smoke AC2 raw cookie shadowing recovers on navigation and language changes", async ({
  request,
}) => {
  const headers = { host: "lotse.example", "x-forwarded-proto": "https", cookie: "" };
  const visitor = await request.post("/api/session", { headers });
  const attacker = await request.post("/api/session", { headers });
  const identities = [await visitor.json(), await attacker.json()];
  const cookies = [visitor, attacker].map(
    (response) => response.headers()["set-cookie"]?.split(";")[0] ?? "",
  );
  for (const cookie of [cookies.join("; "), cookies.toReversed().join("; ")]) {
    for (const path of ["/", "/?lang=en"]) {
      const recovered = await request.get(path, { headers: { ...headers, cookie } });
      expect(recovered.status()).toBe(200);
      const replacement = recovered.headers()["set-cookie"]?.split(";")[0] ?? "";
      expect(replacement).toMatch(/^__Host-lotse_session=/);
      const current = await request.post("/api/session", {
        headers: { ...headers, cookie: replacement },
      });
      const identity = await current.json();
      for (const previous of identities) {
        expect(identity.userId).not.toBe(previous.userId);
        expect(identity.sessionId).not.toBe(previous.sessionId);
      }
    }
  }
});

test("@smoke AC1 standalone health returns 503 with an unavailable database", async () => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.hostname = "127.0.0.1";
  url.port = "1";
  const server = spawn(process.execPath, ["scripts/start-standalone.mjs"], {
    env: { ...process.env, PORT: String(E2E_HEALTH_PORT), DATABASE_URL: url.toString() },
    stdio: "ignore",
  });
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(E2E_HEALTH_URL, { signal: AbortSignal.timeout(5000) })).status;
          } catch {
            return 0;
          }
        },
        { timeout: 20000 },
      )
      .toBe(503);
    const response = await fetch(E2E_HEALTH_URL);
    expect(await response.json()).toEqual({
      status: "degraded",
      dependencies: { database: "down", objectStorage: "up" },
    });
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
  }
});

test("@smoke FR-L4 tutorial highlights a real quote, types and confirms with keyboard and reduced motion", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const setup = page.locator('section[aria-labelledby="setup-title"]');
  for (let step = 0; step < 3; step++) {
    await setup.getByRole("button", { name: "Weiter", exact: true }).focus();
    await page.keyboard.press("Enter");
  }
  await setup.getByRole("button", { name: "Beispielbrief öffnen" }).click();
  await setup.getByRole("button", { name: "Satz zeigen" }).click();
  await expect(setup.locator("mark")).toBeVisible();
  await setup.getByRole("button", { name: "Beispielfeld ausfüllen" }).click();
  const confirm = setup.getByRole("button", { name: "Feldgruppe bestätigen" });
  await expect(confirm).toBeEnabled();
  await expect(confirm).toBeFocused();
  await expect(setup.getByRole("textbox")).not.toHaveValue("");
  await expect(setup.getByText("Entwurf", { exact: true })).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(setup.getByText("Bestätigt", { exact: true })).toBeVisible();
  expect((await (await context.request.get("/api/preferences")).json()).onboardingCompleted).toBe(
    false,
  );
  await setup.getByRole("button", { name: "Einrichtung abschließen" }).click();
  await expect(setup).toHaveCount(0);
  const panel = page.locator("header details");
  await panel.locator("summary").click();
  await panel.getByLabel("Zeigergröße").selectOption("40");
  await panel.getByLabel("Zeigergeschwindigkeit").selectOption("0.5");
  await panel.getByLabel("Weniger Bewegung").check();
  await panel.getByRole("button", { name: "Einstellungen speichern" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-cursor-size", "40");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-cursor-speed", "0.5");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
});
