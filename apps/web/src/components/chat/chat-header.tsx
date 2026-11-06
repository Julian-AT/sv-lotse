// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md); the visibility selector
// and deploy button are replaced by the case title and its support level.
"use client";

import { PanelLeftIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

function PureChatHeader({
  title,
  level,
  showSidebarToggle,
}: {
  title: string;
  level: string;
  showSidebarToggle: boolean;
}) {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar/80 px-3 backdrop-blur-xl">
      {showSidebarToggle && (
        <Button
          aria-label="Seitenleiste umschalten"
          className="md:hidden"
          onClick={toggleSidebar}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftIcon className="size-4" />
        </Button>
      )}

      <h1
        className="m-0 truncate px-1 text-[13px] font-medium text-foreground"
        id="conversation-title"
      >
        {title}
      </h1>

      {level ? (
        <span className="ml-auto rounded-lg border border-border/50 px-2.5 py-1 text-[12px] text-muted-foreground">
          {level}
        </span>
      ) : null}
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader);
