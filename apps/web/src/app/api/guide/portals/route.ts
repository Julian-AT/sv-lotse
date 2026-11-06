import { loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import { GUIDE_ASSET_PATHS } from "@/server/guide-config.ts";

export const runtime = "nodejs";

/** Public portal policy origins, so the workspace re-checks every page before opening it. */
export async function GET(): Promise<Response> {
  const policy = await loadPortalPolicy(GUIDE_ASSET_PATHS.policy);
  return Response.json(
    { origins: policy.origins.map((entry) => entry.origin) },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
