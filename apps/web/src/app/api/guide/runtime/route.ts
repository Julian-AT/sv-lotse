import { readFile } from "node:fs/promises";
import { GUIDE_ASSET_PATHS } from "@/server/guide-config.ts";

export const runtime = "nodejs";

/** Public, immutable code only: no identity, configuration or user data. */
export async function GET(): Promise<Response> {
  const script = await readFile(GUIDE_ASSET_PATHS.bundle, "utf8");
  return new Response(script, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
