import { randomBytes, randomUUID } from "node:crypto";
import { type FullConfig, request } from "@playwright/test";
import { z } from "zod";

/** Compile dev routes before tests create transient approval/invitation UI. No services are replaced. */
export default async function warmup(config: FullConfig): Promise<void> {
  const baseURL = z.url().parse(config.projects[0]?.use.baseURL);
  const context = await request.newContext({ baseURL, timeout: 60_000 });
  try {
    await context.get("/");
    const created = await context.post("/api/cases");
    if (!created.ok()) throw new Error("AUDIT_WARMUP_CASE_FAILED");
    const { case: record } = z
      .object({ case: z.object({ id: z.uuid() }) })
      .parse(await created.json());
    for (const path of [
      "/api/turn",
      "/api/facts",
      "/api/documents",
      `/api/documents/${record.id}/extract`,
      `/api/documents/${record.id}`,
      "/api/relatives/join",
      "/api/relatives/session",
      "/api/relatives/token",
      "/api/invites/accept",
      "/api/invites/sessions",
      "/api/preferences",
      "/api/settings/autonomy",
      `/api/workspace?caseId=${record.id}`,
      `/api/cases/${record.id}/conversation`,
      `/api/cases/${record.id}/steps/${randomUUID()}`,
      `/api/forms/instances/${record.id}`,
      `/api/forms/${record.id}/pdf`,
      "/api/appointments/prepare",
      "/api/appointments/calendar",
      "/api/maplibre/worker",
      "/api/pdfjs/build/pdf.worker.min.mjs",
      "/workspace",
      "/cases",
      `/journey?caseId=${record.id}`,
      `/documents?caseId=${record.id}`,
      `/offers?caseId=${record.id}`,
      `/appointments?caseId=${record.id}`,
      "/guided",
      "/helper",
      "/setup-guide",
      `/invite/${randomBytes(32).toString("hex")}`,
      `/forms/${record.id}`,
      `/cases/${record.id}`,
    ]) {
      const response = await context.get(path);
      if (response.status() >= 500) throw new Error("AUDIT_WARMUP_ROUTE_FAILED");
    }
  } finally {
    await context.dispose();
  }
}
