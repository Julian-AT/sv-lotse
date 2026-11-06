"use client";

import type { LotseMessage } from "@lotse/brain";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import { z } from "zod";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { Button as UiButton } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { hasNativeBridge, mountWorkspaceBridge } from "../bridge/index.ts";
import { SESSION_RESET_EVENT } from "../config.ts";
import { useI18n } from "../i18n/provider.tsx";
import { workspaceFetch } from "./api.ts";
import { WORKSPACE_CONFIG } from "./config.ts";
import { Conversation, type ConversationStart, DraftConversation } from "./conversation.tsx";
import { findCase, normalizeCaseId, selectInitialCase } from "./initial-case.ts";
import { loadConversation } from "./load.ts";
import { type CaseSummary, CaseSummarySchema, CasesResponseSchema } from "./schemas.ts";

type ActiveCase = { summary: CaseSummary; messages: LotseMessage[] };

/** The Mac dashboard switches conversations through this hook instead of reloading the web view. */
type CaseSwitchWindow = Window & { __lotseSelectCase?: (id: string) => boolean };

/** Keeps `?caseId=` in the address in sync (lower-case) without a router navigation. */
function rememberCase(id: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("caseId") === id) return;
  url.searchParams.set("caseId", id);
  window.history.replaceState(window.history.state, "", url);
}

export function Workspace(): JSX.Element {
  const { t } = useI18n();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [active, setActive] = useState<ActiveCase>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const unmount = mountWorkspaceBridge();
    if (hasNativeBridge()) document.documentElement.dataset.nativeWorkspace = "true";
    return () => {
      delete document.documentElement.dataset.nativeWorkspace;
      unmount();
    };
  }, []);
  const select = useCallback(async (summary: CaseSummary): Promise<void> => {
    const version = ++generation.current;
    setLoading(true);
    setFailed(false);
    setActive(undefined);
    try {
      const snapshot = await loadConversation(summary.id, new AbortController().signal);
      if (version === generation.current) setActive({ summary, messages: snapshot.messages });
    } catch {
      if (version === generation.current) setFailed(true);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, []);
  const casesRef = useRef(cases);
  casesRef.current = cases;
  useEffect(() => {
    const target = window as CaseSwitchWindow;
    target.__lotseSelectCase = (id: string): boolean => {
      const wanted = normalizeCaseId(id);
      void (async () => {
        let summary = findCase(casesRef.current, wanted);
        if (!summary) {
          const listed = CasesResponseSchema.parse(
            await workspaceFetch(WORKSPACE_CONFIG.caseListApi),
          ).cases;
          setCases(listed);
          summary = findCase(listed, wanted);
        }
        if (!summary) throw new Error("CASE_ACCESS_DENIED");
        rememberCase(summary.id);
        if (activeRef.current?.summary.id !== summary.id) await select(summary);
      })().catch(() => {
        setFailed(true);
        setLoading(false);
      });
      return true;
    };
    return () => {
      delete target.__lotseSelectCase;
    };
  }, [select]);
  useEffect(() => {
    const reset = (): void => {
      const current = activeRef.current;
      if (current) void select(current.summary);
    };
    window.addEventListener(SESSION_RESET_EVENT, reset);
    return () => window.removeEventListener(SESSION_RESET_EVENT, reset);
  }, [select]);
  const refresh = async (): Promise<CaseSummary[]> => {
    const result = CasesResponseSchema.parse(
      await workspaceFetch(WORKSPACE_CONFIG.caseListApi),
    ).cases;
    setCases(result);
    return result;
  };
  useEffect(() => {
    let mounted = true;
    void workspaceFetch(WORKSPACE_CONFIG.caseListApi)
      .then(async (response) => {
        if (!mounted) return;
        const result = CasesResponseSchema.parse(response).cases;
        setCases(result);
        const first = selectInitialCase(result, window.location.search);
        if (first) {
          if (new URLSearchParams(window.location.search).has("caseId")) rememberCase(first.id);
          await select(first);
        } else if (hasNativeBridge()) {
          const created = z
            .strictObject({ case: CaseSummarySchema })
            .parse(await workspaceFetch(WORKSPACE_CONFIG.casesApi, { method: "POST" }));
          if (mounted) {
            setCases([created.case]);
            await select(created.case);
          }
        } else setLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
      generation.current++;
    };
  }, [select]);
  const pendingStart = useRef<(ConversationStart & { caseId: string }) | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const create = async (start?: ConversationStart): Promise<void> => {
    if (start) setStarting(true);
    else setLoading(true);
    setFailed(false);
    try {
      const response = z
        .strictObject({ case: CaseSummarySchema })
        .parse(await workspaceFetch(WORKSPACE_CONFIG.casesApi, { method: "POST" }));
      pendingStart.current = start ? { ...start, caseId: response.case.id } : undefined;
      setCases((current) => [response.case, ...current]);
      await select(response.case);
    } catch {
      setFailed(true);
      setLoading(false);
    } finally {
      setStarting(false);
    }
  };

  const native = useNativeWorkspace();
  const labels = {
    newChat: t("workspace.newCase"),
    history: t("workspace.cases"),
    untitled: t("workspace.untitled"),
    home: t("workspace.home"),
    empty: t("workspace.noCases"),
  };
  const status = (
    <>
      {loading && !starting && (
        <div
          className="flex h-dvh w-full items-center justify-center bg-background text-[13px] text-muted-foreground"
          role="status"
        >
          {t("workspace.ui.assistant")} …
        </div>
      )}
      {failed && (
        <div
          className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background text-[13px]"
          role="alert"
        >
          <p className="m-0">{t("workspace.loadError")}</p>
          <UiButton
            onClick={() => {
              setLoading(true);
              setFailed(false);
              void refresh()
                .then((items) => (items[0] ? select(items[0]) : setLoading(false)))
                .catch(() => {
                  setFailed(true);
                  setLoading(false);
                });
            }}
            variant="outline"
          >
            {t("workspace.retry")}
          </UiButton>
        </div>
      )}
    </>
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" disableTransitionOnChange enableSystem>
      <TooltipProvider>
        <div className="chatbot-root fixed inset-0 z-50 bg-sidebar font-sans text-foreground antialiased">
          <SidebarProvider defaultOpen={!native}>
            {!native && (
              <AppSidebar
                activeId={active?.summary.id}
                cases={cases}
                disabled={loading}
                labels={labels}
                onNewChat={() => void create()}
                onSelect={(item) => void select(item)}
              />
            )}
            <SidebarInset className="bg-sidebar">
              <Toaster
                position="top-center"
                theme="system"
                toastOptions={{
                  className:
                    "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
                }}
              />
              {active ? (
                <Conversation
                  key={active.summary.id}
                  selectedCase={
                    cases.find((entry) => entry.id === active.summary.id) ?? active.summary
                  }
                  initialMessages={active.messages}
                  onSettled={() => {
                    void refresh().catch(() => setFailed(true));
                  }}
                  showSidebarToggle={!native}
                  autoStart={
                    pendingStart.current?.caseId === active.summary.id
                      ? pendingStart.current
                      : undefined
                  }
                  onAutoStarted={() => {
                    pendingStart.current = undefined;
                  }}
                />
              ) : failed || (loading && !starting) ? (
                status
              ) : (
                <DraftConversation
                  onStart={(start) => void create(start)}
                  showSidebarToggle={!native}
                  starting={starting}
                />
              )}
            </SidebarInset>
          </SidebarProvider>
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}

/** The macOS dashboard has its own sidebar; the embedded workspace hides the template's. */
function useNativeWorkspace(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => setNative(hasNativeBridge()), []);
  return native;
}
