import { expect, it } from "vitest";
import {
  pointedToolCall,
  resultPointAction,
  workspaceTargets,
} from "../../src/workspace/targets.ts";

it("points at the latest result card, else the latest tool row, never at display tools", () => {
  expect(
    pointedToolCall([
      { toolCallId: "a", toolName: "catalog.findBenefits" },
      { toolCallId: "b", toolName: "kb.search" },
      { toolCallId: "c", toolName: "ui.offerResource" },
    ]),
  ).toBe("a");
  expect(pointedToolCall([{ toolCallId: "b", toolName: "kb.search" }])).toBe("b");
  expect(pointedToolCall([{ toolCallId: "c", toolName: "ui.point" }])).toBeUndefined();
  expect(resultPointAction("p", "a")).toMatchObject({
    kind: "point",
    sentenceIndex: 0,
    target: { kind: "ui", elementId: workspaceTargets.resultCard("a") },
  });
});
