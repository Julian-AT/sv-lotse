import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { contracts, type ToolName } from "../../src/tools/contracts/index.ts";
import { buildTools } from "../../src/tools/registry.ts";

const context: RuntimeContext = {
  caseId: randomUUID(),
  subjectId: randomUUID(),
  actorId: randomUUID(),
  userId: randomUUID(),
  sessionId: randomUUID(),
  actorRole: "subject",
  autonomyLevel: "L2",
  shareScope: {},
  sentenceIndex: 3,
};
const inputs: Partial<Record<ToolName, unknown>> = {
  "catalog.findBenefits": { goalText: "Administrative help", subject: {} },
  "catalog.getBenefit": { benefitId: "opaque-reference" },
  "process.start": { caseId: context.caseId, benefitId: "opaque-reference" },
  "process.nextStep": { caseId: context.caseId },
  "process.applyAnswers": { caseId: context.caseId, answers: [] },
  "process.completeStep": { caseId: context.caseId, stepId: "opaque-reference" },
  "kb.search": { query: "Administrative help", filters: {}, k: 3 },
  "office.resolve": { benefitId: "opaque-reference", carrier: "", subjectStatus: "", region: "" },
  "facility.search": { type: "", near: "", radiusKm: 1, filters: {} },
  "appointment.search": {
    facilityIds: [],
    preferences: {
      timeWindow: { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" },
      maxDistanceKm: 1,
      language: "de",
      accessibility: [],
    },
  },
  "appointment.prepare": {
    caseId: context.caseId,
    option: {
      id: "opaque-reference",
      facilityId: "opaque-reference",
      channel: "phone",
      channels: {},
      sources: [],
      retrievedAt: "2026-01-01T00:00:00Z",
    },
    subjectFacts: [],
  },
  "form.find": { need: "Administrative help" },
  "form.acquire": { url: "https://example.org/form" },
  "form.analyze": { templateId: "opaque-reference" },
  "form.getSchema": { templateId: "opaque-reference" },
  "form.prefill": {
    templateId: "opaque-reference",
    caseId: context.caseId,
    subjectId: context.subjectId,
  },
  "form.fillLive": { formInstanceId: "opaque-reference", fieldIds: [] },
  "form.commitGroup": { formInstanceId: "opaque-reference", fieldIds: [], values: {} },
  "documents.checklist": { benefitId: "opaque-reference", subjectId: context.subjectId },
  "package.build": { caseId: context.caseId, formInstanceId: "opaque-reference" },
  "docs.extractStatements": { documentId: "opaque-reference" },
  "eko.lookupCoverage": { medicineNameExact: "" },
  "fees.explainReimbursement": {},
  "handoff.compose": { caseId: context.caseId, scope: [] },
};
it.each(Object.entries(inputs))(
  "NFR-17 %s returns only schema-valid fixtures with explicit opt-in",
  async (name, input) => {
    const toolName = name as ToolName;
    const enabled = buildTools({ allowStubs: true })[toolName];
    const disabled = buildTools({ allowStubs: false })[toolName];
    const options = { context, toolCallId: randomUUID(), messages: [] };
    if (!enabled.execute || !disabled.execute) throw new Error("Missing server tool");
    await expect(disabled.execute(input, options)).rejects.toMatchObject({
      code: "TOOL_NOT_IMPLEMENTED",
    });
    const result = await enabled.execute(input, options);
    expect(contracts[toolName].output.safeParse(result).success).toBe(true);
  },
);

it("binds all display actions to the current sentence and gives client tools no execute", async () => {
  const actions: unknown[] = [];
  const tools = buildTools({
    allowStubs: false,
    writer: {
      write: (part) => {
        actions.push(part);
      },
    },
  });
  for (const name of [
    "ui.point",
    "ui.highlight",
    "ui.annotate",
    "ui.caption",
    "ui.openResource",
  ] as const) {
    const execute = tools[name].execute;
    if (!execute) throw new Error("Missing display tool");
    const result = await execute(
      { target: { kind: "ui", elementId: "reviewed-element" }, label: "Verwaltungsunterlagen" },
      { context, toolCallId: randomUUID(), messages: [] },
    );
    expect(result).toEqual({ actionId: expect.any(String) });
    expect(actions.at(-1)).toMatchObject({
      type: "data-action",
      data: { kind: name.slice(3), sentenceIndex: 3 },
    });
  }
  for (const name of [
    "ui.fill",
    "context.readScreen",
    "context.readPage",
    "calendar.createEvent",
    "session.shareWithHelper",
  ] as const)
    expect(tools[name].execute).toBeUndefined();
});
