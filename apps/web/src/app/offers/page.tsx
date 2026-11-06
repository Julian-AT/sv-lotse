import { WorkspacePage, type WorkspacePageProps } from "@/features/workspace/page.tsx";

export default function Page(props: WorkspacePageProps) {
  return <WorkspacePage {...props} mode="offers" />;
}
