import { notFound } from "next/navigation";
import { z } from "zod";
import { CaseConversation } from "@/conversation/case-conversation.tsx";
import { CaseProgress } from "@/features/workspace/journey.tsx";
import { workspacePreferences } from "@/server/preferences.ts";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { language } = await workspacePreferences();
  return (
    <>
      <CaseConversation key={id} caseId={id} language={language} />
      <CaseProgress key={`progress:${id}`} caseId={id} language={language} />
    </>
  );
}
