import { createHash, createHmac, randomUUID } from "node:crypto";
import { approvals, caseActors, cases, messages } from "@lotse/db/schema";
import type { JsonValue } from "@lotse/protocol";
import { expect, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { database } from "./fixtures.ts";

function sorted(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key] ?? null)]),
  );
}

/** Test-only server-issued administrative state: signatures are real and checked by the real turn API. */
export async function seedApproval(
  page: Page,
  caseId: string,
  toolName: "form.commitGroup",
  input: { formInstanceId: string; fieldIds: string[]; values: Record<string, string> },
): Promise<string> {
  const identity = z
    .object({ userId: z.uuid(), sessionId: z.uuid() })
    .parse(await (await page.request.post("/api/session")).json());
  expect(
    (await page.request.patch("/api/preferences", { data: { autonomyLevel: "L2" } })).ok(),
  ).toBe(true);
  await database.db
    .update(cases)
    .set({ confirmedGoal: "Verwaltungsformular vorbereiten" })
    .where(eq(cases.id, caseId));
  const [actor] = await database.db
    .select()
    .from(caseActors)
    .where(and(eq(caseActors.caseId, caseId), eq(caseActors.userId, identity.userId)));
  if (!actor) throw new Error("AUDIT_ACTOR_REQUIRED");
  const approvalId = randomUUID();
  const toolCallId = randomUUID();
  const inputHash = createHash("sha256")
    .update(JSON.stringify(sorted(input)))
    .digest("hex");
  const binding = { approvalId, toolCallId, toolName, inputHash };
  const hmac = createHmac("sha256", z.string().min(32).parse(process.env.APPROVAL_HMAC_SECRET))
    .update(JSON.stringify(sorted(binding)))
    .digest("hex");
  const digest = createHash("sha256")
    .update(JSON.stringify(sorted(input)))
    .digest("base64url");
  const signature = createHmac("sha256", z.string().min(32).parse(process.env.APPROVAL_HMAC_SECRET))
    .update(JSON.stringify(["ai-sdk-tool-approval-v1", approvalId, toolCallId, toolName, digest]))
    .digest("base64url");
  await database.db
    .insert(approvals)
    .values({ ...binding, hmac, caseId, actorId: actor.id, sessionId: identity.sessionId });
  const message = {
    id: randomUUID(),
    role: "assistant" as const,
    parts: [
      {
        type: "data-approval-context",
        data: {
          ...binding,
          caseId,
          summary: "Die angezeigten Entwürfe dieser Feldgruppe bestätigen.",
          provenance: [],
        },
      },
      {
        type: `tool-${toolName}`,
        toolCallId,
        state: "approval-requested",
        input,
        approval: { id: approvalId, signature },
      },
    ],
  };
  await database.db.delete(messages).where(eq(messages.caseId, caseId));
  const statement = {
    id: randomUUID(),
    role: "user",
    parts: [
      { type: "text", text: "Bitte den Namen Ada in meinem Verwaltungsformular vorbereiten." },
    ],
  };
  await database.sql`INSERT INTO message (case_id, position, ui_message) VALUES (${caseId}, 0, ${JSON.stringify(statement)}::jsonb), (${caseId}, 1, ${JSON.stringify(message)}::jsonb)`;
  return approvalId;
}
