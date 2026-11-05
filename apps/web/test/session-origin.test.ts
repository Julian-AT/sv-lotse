import { expect, test } from "vitest";
import { cookieOptions } from "../src/server/session-cookie.ts";
import { resolveSessionOrigin } from "../src/server/session-origin.ts";

const defaultWorkspace = "http://localhost:3000";

test("production public requests use their own origin and Secure cookies with the optional workspace URL unset", () => {
  const request = new Request("https://lotse.example/api/session");
  expect(resolveSessionOrigin(request, defaultWorkspace)).toBe("https://lotse.example");
  expect(cookieOptions(defaultWorkspace, request).secure).toBe(true);
});

test("a proxy preserving Host resolves the HTTPS public origin without trusting a forwarded host", () => {
  const request = new Request("http://localhost:3000/api/session", {
    headers: {
      host: "lotse.example",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "foreign.example",
    },
  });
  expect(resolveSessionOrigin(request, defaultWorkspace)).toBe("https://lotse.example");
  expect(cookieOptions(defaultWorkspace, request).secure).toBe(true);
});

test("insecure cookies require an HTTP loopback request with no conflicting deployment or proxy authority", () => {
  for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    expect(cookieOptions(defaultWorkspace, new Request(url)).secure).toBe(false);
  }
  for (const request of [
    new Request("https://localhost:3000"),
    new Request("https://lotse.example", { headers: { host: "localhost:3000" } }),
    new Request("http://localhost:3000", { headers: { "x-forwarded-host": "lotse.example" } }),
    new Request("http://localhost:3000", { headers: { "x-forwarded-proto": "https" } }),
  ]) {
    expect(cookieOptions(defaultWorkspace, request).secure).toBe(true);
  }
  expect(cookieOptions("https://lotse.example", new Request(defaultWorkspace)).secure).toBe(true);
  expect(resolveSessionOrigin(new Request(defaultWorkspace), "https://lotse.example")).toBe(
    "https://lotse.example",
  );
});

test("session origins reject malformed request authorities", () => {
  for (const host of [
    "lotse.example@foreign.example",
    "lotse.example/path",
    "lotse.example, foreign.example",
  ]) {
    expect(() =>
      resolveSessionOrigin(new Request(defaultWorkspace, { headers: { host } }), defaultWorkspace),
    ).toThrow();
  }
});
