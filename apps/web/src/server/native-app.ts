import { NATIVE_APP_CONFIG } from "../config.ts";

/** Whether a page request comes from the Mac app's workspace web view. */
export function isNativeAppRequest(userAgent: string | null): boolean {
  return userAgent?.includes(NATIVE_APP_CONFIG.userAgentToken) ?? false;
}

/** Whether a path belongs to the chat surface that only the Mac app embeds. */
export function isEmbeddedPath(pathname: string): boolean {
  const prefix = NATIVE_APP_CONFIG.embeddedPrefix;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

const page = `<!doctype html><html lang="de-AT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>SV KI-Lotse</title></head><body style="font:18px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.4rem">Bitte öffnen Sie SV KI-Lotse in der Mac-App.</h1><p lang="en">Please open SV KI-Lotse in the Mac app.</p></body></html>`;

/** The short page a normal browser gets instead of the embedded chat. */
export function nativeAppRequired(): Response {
  return new Response(page, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
