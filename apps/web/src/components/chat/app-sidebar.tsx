// From Vercel's chatbot template (Apache-2.0, see THIRD_PARTY_NOTICES.md). Chat history is the
// list of SV KI-Lotse cases; auth, delete-all and the user menu are removed.
"use client";

import { HomeIcon, MessageSquareIcon, PanelLeftIcon, PenSquareIcon } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import type { CaseSummary } from "@/conversation/schemas.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function AppSidebar({
  cases,
  activeId,
  disabled,
  labels,
  onSelect,
  onNewChat,
}: {
  cases: CaseSummary[];
  activeId: string | undefined;
  disabled: boolean;
  labels: { newChat: string; history: string; untitled: string; home: string; empty: string };
  onSelect: (item: CaseSummary) => void;
  onNewChat: () => void;
}) {
  const { setOpenMobile, toggleSidebar } = useSidebar();

  const closeMobile = useCallback(() => {
    setOpenMobile(false);
  }, [setOpenMobile]);

  const handleNewChat = useCallback(() => {
    closeMobile();
    onNewChat();
  }, [closeMobile, onNewChat]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="pb-0 pt-3">
        <SidebarMenu>
          <SidebarMenuItem className="flex flex-row items-center justify-between">
            <div className="group/logo relative flex items-center justify-center">
              <SidebarMenuButton
                asChild
                className="size-8 !px-0 items-center justify-center group-data-[collapsible=icon]:group-hover/logo:opacity-0"
                tooltip="SV KI-Lotse"
              >
                <Link aria-label={labels.home} href="/workspace" onClick={closeMobile}>
                  <MessageSquareIcon className="size-4 text-sidebar-foreground/50" />
                </Link>
              </SidebarMenuButton>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    aria-label="Seitenleiste öffnen"
                    className="pointer-events-none absolute inset-0 size-8 opacity-0 group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:group-hover/logo:opacity-100"
                    onClick={toggleSidebar}
                  >
                    <PanelLeftIcon className="size-4" />
                  </SidebarMenuButton>
                </TooltipTrigger>
                <TooltipContent className="hidden md:block" side="right">
                  Seitenleiste öffnen
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="group-data-[collapsible=icon]:hidden">
              <SidebarTrigger className="text-sidebar-foreground/60 transition-colors duration-150 hover:text-sidebar-foreground" />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="pt-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-8 rounded-lg border border-sidebar-border text-[13px] text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  disabled={disabled}
                  onClick={handleNewChat}
                  tooltip={labels.newChat}
                >
                  <PenSquareIcon className="size-4" />
                  <span className="font-medium">{labels.newChat}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
            {labels.history}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {cases.length === 0 ? (
              <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60">
                {labels.empty}
              </div>
            ) : (
              <SidebarMenu>
                {cases.map((item) => {
                  const isActive = item.id === activeId;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        aria-current={isActive ? "page" : undefined}
                        className="h-8 rounded-none text-[13px] text-sidebar-foreground/50 transition-all duration-150 hover:bg-transparent hover:text-sidebar-foreground data-active:bg-transparent data-active:font-normal data-active:text-sidebar-foreground/50 data-[active=true]:text-sidebar-foreground data-[active=true]:font-medium data-[active=true]:border-b data-[active=true]:border-dashed data-[active=true]:border-sidebar-foreground/50"
                        disabled={disabled}
                        isActive={isActive}
                        onClick={() => {
                          closeMobile();
                          onSelect(item);
                        }}
                      >
                        <span className="truncate">{item.confirmedGoal || labels.untitled}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border pt-2 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-8 rounded-lg text-[13px] text-sidebar-foreground/60 hover:text-sidebar-foreground"
              tooltip={labels.home}
            >
              <Link href="/workspace" onClick={closeMobile}>
                <HomeIcon className="size-4" />
                <span>{labels.home}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
