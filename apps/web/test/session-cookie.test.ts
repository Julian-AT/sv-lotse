import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  COOKIE_LIFETIME_MS,
  cookieOptions,
  sessionCookieName,
  signCookie,
  verifyCookie,
} from "../src/server/session-cookie.ts";

const secret = "unit-test-session-secret-32-characters";
const now = Date.now();
const sessionId = randomUUID();

test("signed cookies round-trip and reject tampered, expired and foreign cookies", () => {
  const cookie = signCookie(sessionId, secret, now);
  expect(verifyCookie(cookie, secret, now)?.sessionId).toBe(sessionId);
  expect(verifyCookie(`${cookie}x`, secret, now)).toBeNull();
  const [body, signature] = cookie.split(".");
  const changedBody = Buffer.from(
    JSON.stringify({ v: 1, sessionId: randomUUID(), issuedAt: now }),
  ).toString("base64url");
  expect(verifyCookie(`${changedBody}.${signature}`, secret, now)).toBeNull();
  expect(verifyCookie(cookie, "different-unit-test-secret-32-characters", now)).toBeNull();
  expect(verifyCookie(cookie, secret, now + COOKIE_LIFETIME_MS)).toBeNull();
  expect(verifyCookie(signCookie(sessionId, secret, now + 60_000), secret, now)).toBeNull();
  for (const value of [undefined, "", "foreign-cookie", `${body}.bad`, "a.b.c", "%broken"]) {
    expect(verifyCookie(value, secret, now)).toBeNull();
  }
});

test("cookies are httpOnly, host-only, SameSite Lax and Secure outside localhost", () => {
  const options = (url: string) => cookieOptions(url, new Request(url));
  expect(options("http://localhost:3000")).toMatchObject({
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
  });
  expect(options("http://127.0.0.1:3000").secure).toBe(false);
  expect(options("https://lotse.example").secure).toBe(true);
  expect(options("http://lotse.example").secure).toBe(true);
  expect(options("http://localhost.example").secure).toBe(true);
  expect(options("http://localhost:3000")).not.toHaveProperty("domain");
});

test("public cookies use the Host prefix and never accept the loopback cookie name", () => {
  for (const url of ["https://lotse.example", "http://lotse.example", "https://localhost:3000"]) {
    const request = new Request(url);
    expect(sessionCookieName("http://localhost:3000", request)).toBe("__Host-lotse_session");
    expect(cookieOptions("http://localhost:3000", request)).toMatchObject({
      secure: true,
      path: "/",
    });
    expect(cookieOptions("http://localhost:3000", request)).not.toHaveProperty("domain");
  }
  const local = new Request("http://localhost:3000");
  expect(sessionCookieName("http://localhost:3000", local)).toBe("lotse_session");
  expect(sessionCookieName("https://lotse.example", local)).toBe("__Host-lotse_session");
});
