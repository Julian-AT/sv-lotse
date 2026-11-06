import type { Action, SpeechSegment } from "@lotse/protocol";
import { describe, expect, it, vi } from "vitest";
import { findQuoteRanges } from "../src/features/viewer/quote.ts";
import { storedQuoteBoxes } from "../src/features/viewer/stored-lines.ts";
import { SentenceActions } from "../src/speech/sentence-actions.ts";
import { consumeGuidanceResponse } from "../src/speech/stream.ts";

const action = (id: string, sentenceIndex: number): Action => ({
  id,
  sentenceIndex,
  kind: "highlight",
  target: { kind: "text", quote: "Original sentence.", documentId: "document", page: 2 },
  payload: {},
});

const segment = (index: number, actionIds: string[] = []): SpeechSegment => ({
  turnId: "turn",
  index,
  text: "Original sentence.",
  language: "en",
  citations: [],
  actionIds,
});

describe("FR-D4 exact source quotes", () => {
  it("marks only the quoted characters across PDF text spans and line whitespace", () => {
    expect(
      findQuoteRanges(["Before. Original", "  sentence. After."], "Original\nsentence."),
    ).toEqual([
      { index: 0, start: 8, end: 16 },
      { index: 1, start: 2, end: 11 },
    ]);
  });
  it("refuses similar and ambiguous sentences", () => {
    expect(findQuoteRanges(["Original sentences."], "Original sentence.")).toEqual([]);
    expect(
      findQuoteRanges(["Original sentence.", "Original sentence."], "Original sentence."),
    ).toEqual([]);
  });
  it("uses stored top-left page line boxes only on the cited page", () => {
    const pages = [
      {
        page: 2,
        width: 100,
        height: 200,
        lines: [{ text: "Original sentence.", bbox: { x: 10, y: 40, width: 80, height: 10 } }],
      },
    ];
    expect(storedQuoteBoxes(pages, 2, "Original sentence.", 200, 400)).toEqual([
      { x: 20, y: 80, width: 160, height: 20 },
    ]);
    expect(storedQuoteBoxes(pages, 1, "Original sentence.", 200, 400)).toEqual([]);
  });
});

describe("PRD §9 sentence playback clock", () => {
  it("does not fire on stream arrival and fires each matching action once on audio start", () => {
    const execute = vi.fn();
    const queue = new SentenceActions(execute);
    queue.add(action("first", 0));
    queue.add(action("next", 1));
    expect(execute).not.toHaveBeenCalled();
    queue.start(segment(0));
    queue.start(segment(0));
    expect(execute.mock.calls.map(([entry]) => entry.id)).toEqual(["first"]);
    queue.start(segment(1));
    expect(execute.mock.calls.map(([entry]) => entry.id)).toEqual(["first", "next"]);
  });
  it("fires late actions only for the currently playing sentence and resets between turns", () => {
    const execute = vi.fn();
    const queue = new SentenceActions(execute);
    queue.start(segment(2));
    queue.add(action("past", 1));
    queue.add(action("current", 2));
    expect(execute).toHaveBeenCalledTimes(1);
    queue.reset();
    queue.start(segment(2));
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("also honors explicit action ids carried by a speech segment", () => {
    const execute = vi.fn();
    const queue = new SentenceActions(execute);
    queue.add(action("linked", 8));
    queue.start(segment(0, ["linked"]));
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("delivers sentence parts from fragmented SSE before the response ends", async () => {
    const received: unknown[] = [];
    const text: string[] = [];
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"type":"data-speech-'));
        controller.enqueue(
          encoder.encode(
            'segment","data":{"index":0}}\r\n\r\ndata: {"type":"text-delta","delta":"Hello"}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
    await consumeGuidanceResponse(
      new Response(source),
      (part) => received.push(part),
      (delta) => text.push(delta),
    );
    expect(received).toHaveLength(2);
    expect(text).toEqual(["Hello"]);
  });
});
