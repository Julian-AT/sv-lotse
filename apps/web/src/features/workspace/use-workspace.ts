"use client";

import { type WorkspaceSnapshot, workspaceSnapshotSchema } from "@lotse/brain/workspace/schema";
import { useEffect, useState } from "react";
import { WORKSPACE_API_URL, WORKSPACE_REFRESH_MS } from "./config.ts";

export function useWorkspace(
  query: { caseId?: string; benefitId?: string },
  revision: number,
): { snapshot: WorkspaceSnapshot | null; error: boolean } {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState(false);
  const caseId = query.caseId;
  const benefitId = query.benefitId;
  useEffect(() => {
    let disposed = false;
    let running = false;
    const controller = new AbortController();
    if (revision === 0) setSnapshot(null);
    setError(false);
    async function load(): Promise<void> {
      if (running) return;
      running = true;
      const parameters = new URLSearchParams({
        ...(caseId ? { caseId } : {}),
        ...(benefitId ? { benefitId } : {}),
      });
      try {
        const response = await fetch(`${WORKSPACE_API_URL}?${parameters}`, {
          cache: revision > 0 ? "reload" : "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("WORKSPACE_FAILED");
        const next = workspaceSnapshotSchema.parse(await response.json());
        if (!disposed) {
          setSnapshot(next);
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        running = false;
      }
    }
    const refresh = (): void => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    const interval = window.setInterval(refresh, WORKSPACE_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [caseId, benefitId, revision]);
  return { snapshot, error };
}
