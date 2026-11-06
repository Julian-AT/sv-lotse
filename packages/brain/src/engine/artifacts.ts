import { randomUUID } from "node:crypto";
import { messages } from "@lotse/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { callDrafts } from "../directory/prepare.ts";
import type { BenefitRecord } from "./catalog.ts";
import { processCopy } from "./copy.ts";
import type { Transaction } from "./persistence.ts";
import type { JsonValue, ProcessDefinition, StepDefinition } from "./schema.ts";

const preparation = z.object({ callSheet: z.string().min(1), emailDraft: z.string() });

async function appointmentDrafts(tx: Transaction, caseId: string, benefit: BenefitRecord) {
  const history = await tx
    .select({ message: messages.uiMessage })
    .from(messages)
    .where(eq(messages.caseId, caseId))
    .orderBy(desc(messages.position));
  for (const { message } of history) {
    if (message.role !== "assistant") continue;
    for (const part of [...message.parts].reverse()) {
      const tool = z
        .object({
          type: z.string(),
          toolName: z.string().optional(),
          state: z.literal("output-available"),
          output: preparation,
        })
        .safeParse(part);
      if (
        tool.success &&
        (tool.data.type === "tool-appointment.prepare" ||
          (tool.data.type === "dynamic-tool" && tool.data.toolName === "appointment.prepare"))
      )
        return tool.data.output;
    }
  }
  const channel = benefit.appointment_channels.find((entry) => entry.kind !== "online");
  if (!channel) return undefined;
  const channels =
    channel.kind === "phone"
      ? { phone: channel.number }
      : { email: decodeURIComponent(new URL(channel.url).pathname) };
  return callDrafts({ title: benefit.name_de, channels }, []);
}

/** Sourced administrative drafts only. No document, contact, medical advice or booking is invented. */
export async function preparedArtifacts(
  tx: Transaction,
  caseId: string,
  step: StepDefinition,
  benefit: BenefitRecord,
  definition: ProcessDefinition,
): Promise<JsonValue[]> {
  const artifacts: JsonValue[] = [];
  const base = {
    status: "prepared",
    description: processCopy.prepared,
    sources: definition.sources,
  };
  if (step.documents || step.outputs?.some((output) => output.type === "checklist")) {
    artifacts.push(
      z.json().parse({
        ...base,
        id: randomUUID(),
        type: "checklist",
        documents: step.documents ? benefit.documents : [],
        criteria: step.criteria ? benefit.criteria : [],
        actions: step.action ? [step.action] : [],
      }),
    );
  }
  if (step.documents && benefit.documents.length > 0) {
    artifacts.push(
      z.json().parse({
        ...base,
        id: randomUUID(),
        type: "document_request",
        title: processCopy.documentRequestTitle,
        text: [
          processCopy.documentRequest,
          ...benefit.documents.map(
            (document) =>
              `${document.name_de} — ${processCopy.obtainFrom}: ${document.obtain_from}`,
          ),
          processCopy.documentRequestClosing,
        ].join("\n\n"),
        sources: benefit.documents.map((document) => document.source),
      }),
    );
  }
  if (
    step.action === "appointment.prepare" ||
    step.outputs?.some((output) => ["call_sheet", "follow_up_call_sheet"].includes(output.type))
  ) {
    const drafts = await appointmentDrafts(tx, caseId, benefit);
    if (drafts)
      artifacts.push(
        z.json().parse({
          ...base,
          id: randomUUID(),
          type: "call_sheet",
          text: drafts.callSheet,
          emailDraft: drafts.emailDraft,
        }),
      );
  }
  return artifacts;
}
