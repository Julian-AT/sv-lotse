import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isEmbeddedPath, isNativeAppRequest, nativeAppRequired } from "./server/native-app.ts";
import { pageSession } from "./server/session.ts";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/") return NextResponse.next();
  if (
    isEmbeddedPath(request.nextUrl.pathname) &&
    !isNativeAppRequest(request.headers.get("user-agent"))
  )
    return nativeAppRequired();
  const language = z
    .enum(["de", "en", "de-simple"])
    .safeParse(request.nextUrl.searchParams.get("lang"));
  const response = await pageSession(request);
  if (language.success) {
    response.cookies.set("lotse_language", language.data, {
      path: "/",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return response;
}

// API routes identify callers explicitly through requireSession; health is public. The root is a
// plain service notice without a session.
export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next(?:/|$)|brand(?:/|$)|icons(?:/|$)|favicon.ico|apple-touch-icon.png|manifest.webmanifest|robots.txt|sitemap.xml).*)",
  ],
};
