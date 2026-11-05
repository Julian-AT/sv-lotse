import type { NextRequest } from "next/server";
import { z } from "zod";
import { pageSession } from "./server/session.ts";

export async function proxy(request: NextRequest) {
  const language = z.enum(["de", "en"]).safeParse(request.nextUrl.searchParams.get("lang"));
  const response = await pageSession(request);
  if (language.success)
    response.cookies.set("lotse_language", language.data, {
      path: "/",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
    });
  return response;
}

// API routes identify callers explicitly through requireSession; health is public.
export const config = {
  matcher: ["/((?!api(?:/|$)|_next(?:/|$)|favicon.ico|robots.txt|sitemap.xml).*)"],
};
