import { type CaseEvent, CaseEventSchema } from "@lotse/protocol";
import { z } from "zod";
import type { WorkspaceChecklistItem, WorkspaceStep } from "./schema.ts";

const eventPart = z.object({ type: z.literal("data-case-event"), data: CaseEventSchema });
const toolPart = z.object({
  type: z.literal("tool-case.update"),
  state: z.literal("output-available"),
  output: z.array(CaseEventSchema),
});

/** Only persisted, server-issued parts are passed here. Ignore unrelated UI message parts. */
export function readWorkspaceEvents(parts: readonly unknown[], caseId: string): CaseEvent[] {
  return parts.flatMap((part) => {
    const event = eventPart.safeParse(part);
    if (event.success) return event.data.data.caseId === caseId ? [event.data.data] : [];
    const tool = toolPart.safeParse(part);
    return tool.success ? tool.data.output.filter((entry) => entry.caseId === caseId) : [];
  });
}

export interface StoredWorkspaceStep {
  id: string;
  processStep: string;
  status: "pending" | "in_progress" | "blocked" | "completed";
  owner: "user" | "pilot" | "office";
  dueAt: Date | null;
  linkedArtifacts: readonly unknown[];
  initiatedBy?: "user" | "pilot" | "office";
}

const eventStep = z.object({
  stepId: z.string().optional(),
  id: z.string().optional(),
  description: z.string().optional(),
  title: z.string().optional(),
  owner: z.enum(["user", "pilot", "office"]).optional(),
});

export function projectJourney(
  steps: readonly StoredWorkspaceStep[],
  events: readonly CaseEvent[],
  titles: ReadonlyMap<string, string> = new Map(),
): WorkspaceStep[] {
  const result = new Map<string, WorkspaceStep>();
  for (const step of steps) {
    const prepared =
      step.initiatedBy === "pilot" || (step.owner === "pilot" && step.linkedArtifacts.length > 0);
    const artifacts = step.linkedArtifacts.flatMap((artifact) => {
      const parsed = z
        .object({
          id: z.string(),
          type: z.string(),
          text: z.string(),
          sources: z.array(z.object({ url: z.url(), quote: z.string(), retrieved_at: z.string() })),
        })
        .safeParse(artifact);
      return parsed.success ? [parsed.data] : [];
    });
    result.set(step.id, {
      id: step.id,
      title: titles.get(step.processStep) ?? step.processStep,
      status:
        step.status === "in_progress"
          ? "current"
          : step.status === "completed"
            ? "completed"
            : prepared
              ? "prepared"
              : "pending",
      owner: step.owner,
      ...(step.initiatedBy ? { initiatedBy: step.initiatedBy } : {}),
      ...(artifacts.length ? { artifacts } : {}),
      ...(step.dueAt ? { dueDate: step.dueAt.toISOString() } : {}),
      blocked: step.status === "blocked",
    });
  }
  for (const event of events) {
    const payload = eventStep.safeParse(event.payload);
    if (!payload.success) continue;
    const id = payload.data.stepId ?? payload.data.id;
    if (!id) continue;
    const existing =
      result.get(id) ??
      [...result.values()].find(
        (step) => steps.find((stored) => stored.id === step.id)?.processStep === id,
      );
    if (event.kind === "step_created" && !existing) {
      result.set(id, {
        id,
        title: payload.data.description ?? payload.data.title ?? titles.get(id) ?? id,
        status: "pending",
        owner: payload.data.owner ?? "user",
        blocked: false,
      });
    }
    if (existing && event.kind === "step_completed")
      result.set(existing.id, { ...existing, status: "completed", blocked: false });
    if (existing && event.kind === "artefact_ready" && existing.status !== "completed")
      result.set(existing.id, { ...existing, status: "prepared" });
  }
  return [...result.values()];
}

export interface RequiredWorkspaceDocument {
  id: string;
  name_de: string;
  required: boolean;
  obtain_from: string;
  source: WorkspaceChecklistItem["source"];
}

/** Exact catalog document types only: never infer possession from an unrelated medical fact. */
export function projectChecklist(
  requirements: readonly RequiredWorkspaceDocument[],
  documentTypes: readonly string[],
): WorkspaceChecklistItem[] {
  const present = new Set(documentTypes);
  return requirements
    .filter((document) => document.required)
    .map((document) => ({
      id: document.id,
      title: document.name_de,
      status:
        present.has(document.id) || present.has(document.name_de)
          ? "have"
          : document.obtain_from.trim()
            ? "obtainable"
            : "missing",
      where: document.obtain_from,
      source: document.source,
    }));
}
