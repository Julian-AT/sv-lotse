import { z } from "zod";

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

function requestOriginUrl(request: Request): URL {
  let url = new URL(request.url);
  // Host is the browser's target authority. Proxies must preserve it or use an
  // explicit public workspace URL; never select an origin from X-Forwarded-Host.
  const host = request.headers.get("host");
  if (host !== null) {
    const authority = z
      .string()
      .regex(/^[a-z\d.:[\]-]+$/i)
      .safeParse(host);
    const candidate = z.url({ protocol: /^https?$/ }).safeParse(`${url.protocol}//${host}`);
    if (!authority.success || !candidate.success) throw new Error("Invalid request authority");
    url = new URL(candidate.data);
  }
  // A forwarding header may strengthen transport security, never downgrade it.
  if (request.headers.get("x-forwarded-proto") === "https") url.protocol = "https:";
  return url;
}

export function resolveSessionOrigin(request: Request, workspaceUrl: string): string {
  const configured = new URL(workspaceUrl);
  const actual = requestOriginUrl(request);
  return isLoopback(configured.hostname) ? actual.origin : configured.origin;
}

export function isVerifiedLoopback(request: Request, workspaceUrl: string): boolean {
  const configured = new URL(workspaceUrl);
  const original = new URL(request.url);
  const actual = requestOriginUrl(request);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  return (
    configured.protocol === "http:" &&
    isLoopback(configured.hostname) &&
    original.protocol === "http:" &&
    isLoopback(original.hostname) &&
    actual.protocol === "http:" &&
    isLoopback(actual.hostname) &&
    (forwardedHost === null || forwardedHost === actual.host) &&
    (forwardedProtocol === null || forwardedProtocol === "http")
  );
}
