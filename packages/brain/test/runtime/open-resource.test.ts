import { randomUUID } from "node:crypto";
import { loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import { createUIMessageStreamResponse, type ModelMessage, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import { createLotseAgent, POLICY } from "../../src/agent/index.ts";
import { BOOKING_ALLOWLIST_FILE } from "../../src/config/index.ts";
import {
  answersOffer,
  guidanceOffer,
  isGuidanceRequest,
  offerChunks,
  resourceIsOpen,
} from "../../src/tools/impl/ui/resource.ts";
import { buildTools } from "../../src/tools/registry.ts";
import { chunks, config } from "./helpers.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const context = () => ({
  caseId: randomUUID(),
  subjectId: randomUUID(),
  actorId: randomUUID(),
  userId: randomUUID(),
  sessionId: randomUUID(),
  actorRole: "subject" as const,
  autonomyLevel: "L1" as const,
  shareScope: {},
  sentenceIndex: 0,
});
type Step = { tool: string; input: unknown } | { text: string };

/** Replays one scripted step per model call and records every prompt. */
function scripted(steps: Step[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[call++] ?? { text: "" };
      const parts =
        "tool" in step
          ? [
              {
                type: "tool-call" as const,
                toolCallId: randomUUID(),
                toolName: step.tool,
                input: JSON.stringify(step.input),
              },
            ]
          : [
              { type: "text-start" as const, id: "t" },
              { type: "text-delta" as const, id: "t", delta: step.text },
              { type: "text-end" as const, id: "t" },
            ];
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            ...parts,
            {
              type: "finish" as const,
              finishReason: { unified: "tool" in step ? "tool-calls" : "stop", raw: undefined },
              usage,
            } as never,
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  });
}

let portalUrl = "";
beforeAll(async () => {
  const policy = await loadPortalPolicy(BOOKING_ALLOWLIST_FILE);
  const origin = policy.origins[0]?.origin;
  if (!origin) throw new Error("Portal policy has no origin");
  portalUrl = `${origin}/antrag`;
});

async function run(steps: Step[], options: { messages?: ModelMessage[]; capsule?: object } = {}) {
  const model = scripted(steps);
  const actions: unknown[] = [];
  const agent = createLotseAgent({
    config,
    model,
    context: context(),
    dependencies: {
      allowStubs: false,
      ...(options.capsule ? { capsule: options.capsule } : {}),
      writer: { write: (part) => void actions.push(part) },
    },
  });
  const result = await agent.stream(
    options.messages ? { messages: options.messages } : { prompt: "Wo beantrage ich Pflegegeld?" },
  );
  const parts = await chunks(createUIMessageStreamResponse({ stream: result.toUIMessageStream() }));
  return { parts, actions, model };
}

describe("open the right page, then point", () => {
  it("instructs the pilot to check the state and ask one short question", () => {
    expect(POLICY).toContain("Soll ich <Name> für Sie öffnen?");
    expect(POLICY).toContain("ui.offerResource");
  });

  it("state check: a resource that is not open yields an offer and the short question", async () => {
    const { parts } = await run([
      {
        tool: "ui.offerResource",
        input: {
          target: { kind: "dom", handle: "page", url: portalUrl },
          label: "die Antragsseite",
        },
      },
      { text: "Soll ich die Antragsseite für Sie öffnen?" },
    ]);
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: expect.objectContaining({ open: false, label: "die Antragsseite" }),
      }),
    );
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "text-delta",
        delta: "Soll ich die Antragsseite für Sie öffnen?",
      }),
    );
  });

  it("state check: the capsule decides whether the page is already open", () => {
    const target = { kind: "dom" as const, handle: "page", url: portalUrl };
    expect(resourceIsOpen(target, undefined)).toBe(false);
    expect(resourceIsOpen(target, { page: { url: `${portalUrl}/`, handles: [] } })).toBe(true);
    expect(
      resourceIsOpen(target, { page: { url: "https://example.org/antrag", handles: [] } }),
    ).toBe(false);
  });

  it("refuses to offer a page outside the portal allowlist", async () => {
    const execute = buildTools({ allowStubs: false })["ui.offerResource"].execute;
    if (!execute) throw new Error("Missing offer tool");
    await expect(
      execute(
        { target: { kind: "dom", handle: "page", url: "https://evil.example/antrag" }, label: "x" },
        { toolCallId: "call", messages: [], context: context() },
      ),
    ).rejects.toThrow("RESOURCE_NOT_ALLOWED");
  });

  it('"ja" leads to a ui.openResource client call for an allowlisted page', async () => {
    const target = { kind: "dom", handle: "page", url: portalUrl };
    const { parts } = await run([{ tool: "ui.openResource", input: { target } }]);
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "ui.openResource",
        input: { target },
      }),
    );
    expect(parts.some((part) => part.type === "tool-output-denied")).toBe(false);
  });

  it("denies ui.openResource for a non-allowlisted origin on the server", async () => {
    const { parts } = await run([
      {
        tool: "ui.openResource",
        input: { target: { kind: "dom", handle: "page", url: "https://evil.example/" } },
      },
      { text: "" },
    ]);
    expect(parts).toContainEqual(expect.objectContaining({ type: "tool-output-denied" }));
  });

  it("after the ActionResult the pilot points at the relevant place", async () => {
    const toolCallId = randomUUID();
    const target = { kind: "dom" as const, handle: "page", url: portalUrl };
    const messages: ModelMessage[] = [
      { role: "user", content: "Ja, öffnen" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId, toolName: "ui.openResource", input: { target } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: "ui.openResource",
            output: {
              type: "json",
              value: { actionId: toolCallId, resolvedBy: "dom", confidence: 1, success: true },
            },
          },
        ],
      },
    ];
    const { actions, model } = await run(
      [
        {
          tool: "ui.point",
          input: { target: { kind: "text", quote: "Antrag auf Pflegegeld" }, label: "Hier" },
        },
        { text: "Hier finden Sie den Antrag." },
      ],
      { messages },
    );
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('"success":true');
    expect(actions).toContainEqual(
      expect.objectContaining({
        type: "data-action",
        data: expect.objectContaining({ kind: "point" }),
      }),
    );
  });
});

it("the pilot policy stays inside its context budget", async () => {
  const { CONTEXT_SHARES, PIPELINE_CONFIG } = await import("../../src/config/index.ts");
  const { tokenEstimate } = await import("../../src/context/index.ts");
  expect(tokenEstimate(POLICY)).toBeLessThanOrEqual(
    (PIPELINE_CONFIG.contextTokens * CONTEXT_SHARES.policy) / 100,
  );
});

it("recognises where-to-apply requests, also behind a bare goal confirmation", () => {
  expect(isGuidanceRequest(["Wo beantrage ich Pflegegeld?"])).toBe(true);
  expect(isGuidanceRequest(["Zeigen Sie mir bitte das Formular"])).toBe(true);
  expect(isGuidanceRequest(["Where do I apply for care allowance?"])).toBe(true);
  expect(isGuidanceRequest(["Ja", "Wo beantrage ich Pflegegeld?"])).toBe(true);
  expect(isGuidanceRequest(["Wie hoch ist das Pflegegeld?"])).toBe(false);
  expect(isGuidanceRequest(["Ja", "Wie hoch ist das Pflegegeld?"])).toBe(false);
});

it("offers the most relevant allowlisted page as a completed offer in its own step", async () => {
  const offer = await guidanceOffer({
    userTexts: ["Wo beantrage ich Pflegegeld?"],
    sources: [{ url: "https://evil.example/pflegegeld" }, { url: portalUrl }],
  });
  expect(offer).toMatchObject({ target: { kind: "dom", url: portalUrl, handle: "page" } });
  expect(
    await guidanceOffer({
      userTexts: ["Wo beantrage ich Pflegegeld?"],
      sources: [{ url: "https://evil.example/" }],
    }),
  ).toBeUndefined();
  if (!offer) throw new Error("offer expected");
  const chunks = offerChunks("call-1", offer);
  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "start-step",
    "tool-input-available",
    "tool-output-available",
    "finish-step",
    "start-step",
  ]);
  expect(chunks[2]).toMatchObject({ output: { open: false, label: offer.label } });
});

it("does not offer again while the user answers an offer", () => {
  const assistant = (type: string) =>
    [
      {
        id: "a",
        role: "assistant",
        parts: [{ type, toolCallId: "t", state: "output-available", input: {}, output: {} }],
      },
    ] as never;
  expect(answersOffer(assistant("tool-ui.offerResource"))).toBe(true);
  expect(answersOffer(assistant("tool-kb.search"))).toBe(false);
});
