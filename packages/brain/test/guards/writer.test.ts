import { describe, expect, it } from "vitest";
import {
  createGuardedDataWriter,
  type GuardedResponse,
  guardCopy,
} from "../../src/guards/index.ts";

const rejected: GuardedResponse = {
  disposition: "handoff",
  reason: "rule",
  text: guardCopy.de.handoff,
};
describe("guarded tool display and voice data", () => {
  it("unsafe action captions are replaced before they can point or render", async () => {
    const written: unknown[] = [];
    const writer = createGuardedDataWriter(
      { write: (part) => written.push(part) },
      async () => rejected,
      { passages: [] },
    );
    writer.write({
      type: "data-action",
      data: {
        id: "action",
        kind: "caption",
        target: { kind: "ui", elementId: "element" },
        payload: { label: "forbidden synthetic caption" },
        sentenceIndex: 0,
      },
    });
    expect(written).toEqual([]);
    await writer.flush();
    expect(written).toEqual([
      expect.objectContaining({ type: "text-start" }),
      expect.objectContaining({ type: "text-delta", delta: guardCopy.de.handoff }),
      expect.objectContaining({ type: "text-end" }),
    ]);
  });
  it("unsafe spoken text loses its citations and synchronized actions", async () => {
    const written: unknown[] = [];
    const writer = createGuardedDataWriter(
      { write: (part) => written.push(part) },
      async () => rejected,
      { passages: [] },
    );
    writer.write({
      type: "data-speech-segment",
      data: {
        turnId: "turn",
        index: 0,
        text: "synthetic forbidden speech",
        language: "de",
        citations: [{ passageId: "forged", url: "https://example.org", quote: "unverified" }],
        actionIds: ["action"],
      },
    });
    await writer.flush();
    expect(written).toEqual([
      {
        type: "data-speech-segment",
        data: {
          turnId: "turn",
          index: 0,
          text: guardCopy.de.handoff,
          language: "de",
          citations: [],
          actionIds: [],
        },
      },
    ]);
  });
  it("a repaired caption never releases the rejected original action", async () => {
    const written: unknown[] = [];
    const writer = createGuardedDataWriter(
      { write: (part) => written.push(part) },
      async () => ({
        text: "Which form do you mean?",
        disposition: "rewrite",
        reason: "classifier",
      }),
      { passages: [] },
    );
    writer.write({
      type: "data-action",
      data: {
        id: "action",
        kind: "caption",
        target: { kind: "ui", elementId: "element" },
        payload: { label: "synthetic rejected caption" },
        sentenceIndex: 0,
      },
    });
    await writer.flush();
    expect(written).toEqual([
      expect.objectContaining({ type: "text-start" }),
      expect.objectContaining({ type: "text-delta", delta: "Which form do you mean?" }),
      expect.objectContaining({ type: "text-end" }),
    ]);
  });
  it("valid administrative captions preserve the original action and order", async () => {
    const written: unknown[] = [];
    const writer = createGuardedDataWriter(
      { write: (part) => written.push(part) },
      async ({ text }) => ({ text, disposition: "allow", reason: "allowed" }),
      { passages: [] },
    );
    const part = {
      type: "data-action" as const,
      data: {
        id: "action",
        kind: "caption" as const,
        target: { kind: "ui" as const, elementId: "element" },
        payload: { label: "Hier finden Sie die Beilagen." },
        sentenceIndex: 0,
      },
    };
    writer.write(part);
    await writer.flush();
    expect(written).toEqual([part]);
  });
});
