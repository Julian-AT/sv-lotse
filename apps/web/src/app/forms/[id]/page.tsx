import { notFound } from "next/navigation";
import { z } from "zod";
import { FormViewerWorkspace } from "@/features/form-viewer/workspace.tsx";
import { workspacePreferences } from "@/server/preferences.ts";

export default async function FormPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { language } = await workspacePreferences();
  return <FormViewerWorkspace key={id} formInstanceId={id} language={language} />;
}
