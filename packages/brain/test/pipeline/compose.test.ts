import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { expect, test, vi } from "vitest";
import {
  type BoundaryClassification,
  extractCitedClaims,
  guardCopy,
  guardResponse,
} from "../../src/guards/index.ts";
import {
  type ComposedAnswer,
  composeAnswer,
  dropUnsupportedSentences,
  renderComposedAnswer,
  toolSources,
} from "../../src/pipeline/compose.ts";
import { segmentAnswer } from "../../src/pipeline/segment.ts";
import type { Passage } from "../../src/retrieval/index.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
function structuredModel(answer: ComposedAnswer) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(answer) }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
}
const passage: Passage = {
  id: "kb-pflegegeld-antrag",
  url: "https://www.sozialversicherung.at/pflegegeld",
  text: "Der Antrag auf Pflegegeld ist beim zuständigen Pensionsversicherungsträger zu stellen.",
  validFrom: "2026-01-01",
  validTo: null,
};
const evidence = { id: passage.id, text: passage.text, url: passage.url };
const allowed: BoundaryClassification = {
  violation: false,
  score: 0,
  category: "none",
  responseKind: "administrative",
  taskAddressed: true,
};

test("structured composer output becomes cited speech segments that pass the response guard", async () => {
  const composed = await composeAnswer({
    model: structuredModel({
      sentences: [
        {
          text: "Den Antrag auf Pflegegeld stellen Sie beim Pensionsversicherungsträger.",
          kind: "fact",
          passageIds: [passage.id],
        },
        { text: "Bei welcher Versicherung ist Ihre Mutter?", kind: "question", passageIds: [] },
      ],
    }),
    userText: "Wo stelle ich den Antrag auf Pflegegeld?",
    language: "de-AT",
    sources: [passage],
  });
  expect(composed).toMatchObject({ cited: 1, dropped: 0 });
  expect(composed.text).toContain(`[passage:${passage.id}]`);
  const segments = segmentAnswer(
    composed.text,
    randomUUID(),
    "de-AT",
    new Map([[passage.id, passage]]),
  );
  expect(segments[0]).toMatchObject({
    text: "Den Antrag auf Pflegegeld stellen Sie beim Pensionsversicherungsträger.",
    citations: [{ passageId: passage.id, url: passage.url, quote: passage.text }],
  });
  expect(segments[1]?.citations).toEqual([]);
  const supports = vi.fn(async (_claim: string) => true);
  const guarded = await guardResponse(
    {
      text: composed.text,
      userText: "Wo stelle ich den Antrag auf Pflegegeld?",
      passages: [evidence],
      claims: extractCitedClaims(composed.text, [evidence]),
    },
    { classify: async () => allowed, supports },
  );
  expect(guarded).toMatchObject({ disposition: "allow", text: composed.text });
  expect(supports).toHaveBeenCalledOnce();
  // The verifier receives the cited sentence itself, not its neighbour.
  expect(supports.mock.calls[0]?.[0]).toContain("Pensionsversicherungsträger");
});

test("facts without a known supporting id are removed, never emitted uncited", () => {
  const rendered = renderComposedAnswer(
    {
      sentences: [
        { text: "Die Rezeptgebühr beträgt 2026 genau 99 Euro.", kind: "fact", passageIds: [] },
        { text: "Pflegegeld gibt es immer.", kind: "fact", passageIds: ["invented-id"] },
        {
          text: "Den Antrag stellen Sie beim Träger. [passage:invented-id]",
          kind: "fact",
          passageIds: [passage.id],
        },
      ],
    },
    [passage],
    "de-AT",
  );
  expect(rendered.dropped).toBe(2);
  expect(rendered.cited).toBe(1);
  expect(rendered.text).not.toContain("99 Euro");
  expect(rendered.text).not.toContain("invented-id");
  expect(rendered.text).toBe(`Den Antrag stellen Sie beim Träger [passage:${passage.id}].`);
});

test("an answer without any supported fact becomes an explicit unknown", () => {
  const rendered = renderComposedAnswer(
    { sentences: [{ text: "Das kostet 12 Euro.", kind: "fact", passageIds: [] }] },
    [passage],
    "de-AT",
  );
  expect(rendered.text).toBe(guardCopy.de.unknown);
});

test("sourced tool results become citable evidence", () => {
  const sources = toolSources("call_abc123", {
    id: "office-1",
    title: "PVA Landesstelle Wien",
    sources: [
      {
        url: "https://www.pv.at/kontakt",
        quote: "Landesstelle Wien, Friedrich-Hillegeist-Straße 1",
        asOf: "2026-10-01",
      },
    ],
  });
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatchObject({ url: "https://www.pv.at/kontakt", validFrom: "2026-10-01" });
  expect(sources[0]?.text).toContain("PVA Landesstelle Wien");
});

test("sentences the support verifier rejects are removed before the guards run", async () => {
  const text = `Den Antrag stellen Sie beim Pensionsversicherungsträger [passage:${passage.id}]. Pflegegeld gibt es ab Stufe 9 [passage:${passage.id}].`;
  const supports = vi.fn(async (claim: string) => !claim.includes("Stufe 9"));
  const result = await dropUnsupportedSentences(text, [evidence], supports, "de-AT");
  expect(result).toEqual({
    removed: 1,
    text: `Den Antrag stellen Sie beim Pensionsversicherungsträger [passage:${passage.id}].`,
  });
  const none = await dropUnsupportedSentences(text, [evidence], async () => false, "de-AT");
  expect(none.text).toBe(guardCopy.de.unknown);
});
