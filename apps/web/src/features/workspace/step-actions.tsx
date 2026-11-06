"use client";

import type { WorkspaceStep } from "@lotse/brain/workspace/schema";
import { type JSX, useState } from "react";
import { z } from "zod";
import type { WorkspaceCopy } from "./copy.ts";
import styles from "./workspace.module.css";

export function StepActions({
  caseId,
  step,
  copy,
  onChanged,
}: {
  caseId: string;
  step: WorkspaceStep;
  copy: WorkspaceCopy;
  onChanged: () => void;
}): JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  // Event-only steps have no persisted row to update. Office actions remain with the office.
  if (!z.uuid().safeParse(step.id).success || step.owner !== "user" || step.blocked) return null;
  async function update(status: "in_progress" | "completed"): Promise<void> {
    setPending(true);
    setError(false);
    try {
      const response = await fetch(`/api/cases/${caseId}/steps/${encodeURIComponent(step.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("STEP_UPDATE_FAILED");
      onChanged();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={styles.actions}>
      {step.status !== "current" && step.status !== "completed" && (
        <button type="button" disabled={pending} onClick={() => void update("in_progress")}>
          {copy.startStep}
        </button>
      )}
      {step.status !== "completed" && (
        <button type="button" disabled={pending} onClick={() => void update("completed")}>
          {copy.completeStep}
        </button>
      )}
      {error && <p role="alert">{copy.error}</p>}
    </div>
  );
}
