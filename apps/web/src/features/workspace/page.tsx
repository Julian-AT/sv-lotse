import type { JSX } from "react";
import { workspacePreferences } from "@/server/preferences.ts";
import type { WorkspaceMode } from "./copy.ts";
import { WorkspaceClient } from "./workspace.tsx";

export interface WorkspacePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function WorkspacePage({
  mode,
  searchParams,
}: WorkspacePageProps & { mode: WorkspaceMode }): Promise<JSX.Element> {
  const [parameters, preferences] = await Promise.all([searchParams, workspacePreferences()]);
  const caseId = typeof parameters.caseId === "string" ? parameters.caseId : undefined;
  const benefitId = typeof parameters.benefitId === "string" ? parameters.benefitId : undefined;
  const facilityId = typeof parameters.facilityId === "string" ? parameters.facilityId : undefined;
  return (
    <WorkspaceClient
      key={`${mode}:${caseId ?? ""}:${benefitId ?? ""}`}
      mode={mode}
      language={preferences.language}
      initialQuery={{ ...(caseId ? { caseId } : {}), ...(benefitId ? { benefitId } : {}) }}
      initialFacilityId={facilityId ?? ""}
    />
  );
}
