import { loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import { GuidedPortal } from "@/features/guided-portal/guided-portal.tsx";
import { GUIDE_ASSET_PATHS } from "@/server/guide-config.ts";
import { workspacePreferences } from "@/server/preferences.ts";

export default async function GuidedPage() {
  const { language } = await workspacePreferences();
  const policy = await loadPortalPolicy(GUIDE_ASSET_PATHS.policy);
  return <GuidedPortal language={language} portals={policy.origins} />;
}
