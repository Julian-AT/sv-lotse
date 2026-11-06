import type { JSX } from "react";
import { Workspace } from "@/conversation/workspace.tsx";

export default async function WorkspacePage(): Promise<JSX.Element> {
  return <Workspace />;
}
