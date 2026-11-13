// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md); the visibility selector
// and deploy button are removed. The title stays for screen readers only.
"use client";

import { PanelLeftIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

function PureChatHeader({
  title,
  showSidebarToggle,
}: {
  title: string;
  showSidebarToggle: boolean;
}) {
  const { toggleSidebar } = useSidebar();
  const heading = (
    <h1 className="sr-only" id="conversation-title">
      {title}
    </h1>
  );
  if (!showSidebarToggle) return heading;

  return (
    <header className="sticky top-0 flex h-12 items-center gap-2 px-3 md:hidden">
      <Button
        aria-label="Seitenleiste umschalten"
        onClick={toggleSidebar}
        size="icon-sm"
        variant="ghost"
      >
        <PanelLeftIcon className="size-4" />
      </Button>
      {heading}
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader);
