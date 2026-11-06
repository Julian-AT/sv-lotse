import { expect, test } from "vitest";
import { streamEvidence } from "../../src/e4/adapter.ts";
import { loadScenarios, openingFor, ScenarioInputSchema } from "../../src/e4/data.ts";
import { safeEvidence, scenarioScore } from "../../src/e4/index.ts";
import type { Rubric } from "../../src/judge/index.ts";
import type { JudgeResult } from "../../src/schema/index.ts";

const rubric: Rubric = {
  id: "test",
  version: "1",
  description: "Test administrative evidence",
  criteria: [
    {
      id: "question_efficiency",
      scale: "three_point",
      anchors: {
        "0": "Missing",
        "1": "Some excess",
        "2": "Matches the process engine minimum; if baseline is unavailable, unverified",
      },
    },
    { id: "boundary", scale: "binary", anchors: { "0": "Violation", "1": "Administrative only" } },
  ],
};
const result: JudgeResult = {
  model: "test",
  rubricId: "test",
  rubricVersion: "1",
  promptVersion: "1",
  scores: {
    question_efficiency: { score: 2, rationale: "Matches" },
    boundary: { score: 1, rationale: "Administrative" },
  },
};

test("E4 does not credit maximum judge scores without real engine evidence or after a failed turn", () => {
  expect(scenarioScore(rubric, result, false, false).passed).toBe(false);
  expect(scenarioScore(rubric, result, true, true).passed).toBe(false);
  expect(scenarioScore(rubric, result, true, false).passed).toBe(true);
  expect(
    scenarioScore(
      rubric,
      { ...result, scores: { ...result.scores, boundary: { score: 0, rationale: "Violation" } } },
      true,
      false,
    ).passed,
  ).toBe(false);
});

test("E4 loads all five existing slices with exact openings and independent rubrics", async () => {
  const slices = await loadScenarios(["s1", "s2", "s3", "s4", "s5"]);
  expect(slices).toHaveLength(5);
  expect(slices.flatMap((slice) => slice.cases)).toHaveLength(100);
  for (const slice of slices)
    for (const item of slice.cases)
      expect(openingFor(ScenarioInputSchema.parse(item.input))).not.toBe("");
});

test("E4 stream evidence preserves actual data events and sanitizes stream errors", () => {
  expect(
    streamEvidence(
      'data: {"type":"text-delta","delta":"not evidence"}\n\ndata: {"type":"data-case-event","data":{"kind":"goal_confirmed"}}\n\ndata: {"type":"error","errorText":"private response"}\n\ndata: [DONE]\n',
    ),
  ).toEqual([
    { type: "data-case-event", data: { kind: "goal_confirmed" } },
    { type: "pipeline_error" },
  ]);
});

test("E4 diagnostics exclude transcript, document contents, input values and raw errors", () => {
  const evidence = safeEvidence({
    caseId: "case",
    record: { confirmed_goal: "private goal", status: "active" },
    turns: [{ status: "failed", model_ids: { used: ["model"] } }],
    tools: [
      {
        type: "tool-docs.extractStatements",
        state: "output-error",
        input: "private",
        errorText: "provider response",
      },
    ],
    approvals: [],
    importedDocumentId: null,
    questionBaselines: [],
  });
  expect(JSON.stringify(evidence)).not.toMatch(/private|provider response/);
  expect(evidence).toMatchObject({ goalConfirmed: true, questionBaselineCount: 0 });
});

test("E4 preserves helper identity across the authored input formats", async () => {
  const { actorRoleFor } = await import("../../src/e4/data.ts");
  const slices = await loadScenarios(["s1", "s2", "s3", "s4", "s5"]);
  for (const slice of slices)
    for (const item of slice.cases) {
      const input = ScenarioInputSchema.parse(item.input);
      if (slice.scenario === "s1" || item.tags.includes("helper"))
        expect(actorRoleFor(input)).toBe("helper");
    }
});

test("E4 stores only explicitly approved PDF pages and rejects invalid page permissions", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const { approvedDocumentBytes } = await import("../../src/e4/documents.ts");
  const original = await PDFDocument.create();
  original.addPage([100, 100]);
  original.addPage([200, 200]);
  const bytes = await original.save();
  const visible = await PDFDocument.load(await approvedDocumentBytes(bytes, 2, [1]));
  expect(visible.getPageCount()).toBe(1);
  expect(visible.getPage(0).getWidth()).toBe(100);
  for (const pages of [[], [0], [3], [1, 1]])
    await expect(approvedDocumentBytes(bytes, 2, pages)).rejects.toThrow("invalid_document_pages");
});
