import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { RuntimeContext } from "../../src/agent/context.ts";
import { parseBrainConfig } from "../../src/config/index.ts";
import { copyFor } from "../../src/pipeline/copy.ts";
import { guardAnswer } from "../../src/pipeline/guards.ts";
import { createSegmentWriter } from "../../src/pipeline/segment.ts";

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: generate,
}));
const config = parseBrainConfig({ APPROVAL_HMAC_SECRET: randomUUID() });
beforeEach(() => {
  generate.mockReset();
});
it("medical output is replaced before text, speech or actions reach the client", async () => {
  generate.mockResolvedValue({ output: { medicalViolation: true, unsupportedClaim: false } });
  const writes: unknown[] = [];
  const context: RuntimeContext = {
    caseId: randomUUID(),
    subjectId: randomUUID(),
    actorId: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    actorRole: "subject",
    autonomyLevel: "L1",
    shareScope: {},
    sentenceIndex: 3,
  };
  const output = createSegmentWriter({
    writer: {
      write: (part) => {
        writes.push(part);
      },
    },
    context,
    turnId: randomUUID(),
    language: "de-AT",
    config,
    passages: new Map(),
  });
  output.action({
    id: randomUUID(),
    kind: "point",
    target: { kind: "ui", elementId: "unsafe-target" },
    sentenceIndex: 3,
    payload: {},
  });
  await output.write({ type: "text-start", id: "answer" });
  await output.write({
    type: "text-delta",
    id: "answer",
    delta: "An unsafe medical interpretation.",
  });
  expect(writes).toEqual([]);
  await output.write({ type: "text-end", id: "answer" });
  expect(writes).toEqual([]);
  await output.finish();
  expect(writes).toContainEqual({ type: "text-delta", id: "answer", delta: copyFor("de").handoff });
  expect(writes).not.toContainEqual(expect.objectContaining({ type: "data-action" }));
  expect(output.segments[0]?.index).toBe(3);
  expect(JSON.stringify(writes)).not.toContain("unsafe");
});
it("the rule guard blocks dosage advice without calling a model", async () => {
  expect(await guardAnswer(config, "Nehmen Sie 50 mg.", "de-AT", new Map())).toBe(
    copyFor("de").handoff,
  );
  expect(generate).not.toHaveBeenCalled();
});
it("the citation verifier rejects a fabricated passage before model verification", async () => {
  expect(await guardAnswer(config, "Eine Regel [passage:invented].", "de-AT", new Map())).toBe(
    copyFor("de").unsupported,
  );
  expect(generate).not.toHaveBeenCalled();
});
it("unsupported claims and unavailable guard providers fail closed", async () => {
  generate.mockResolvedValueOnce({ output: { medicalViolation: false, unsupportedClaim: true } });
  expect(await guardAnswer(config, "Ein unbelegter Anspruch.", "de-AT", new Map())).toBe(
    copyFor("de").unsupported,
  );
  generate.mockRejectedValueOnce(new Error("Unavailable"));
  expect(await guardAnswer(config, "Ein weiterer unbelegter Anspruch.", "de-AT", new Map())).toBe(
    copyFor("de").unsupported,
  );
});
it("display labels are checked together with the answer", async () => {
  generate.mockResolvedValue({ output: { medicalViolation: false, unsupportedClaim: false } });
  const writes: unknown[] = [];
  const context: RuntimeContext = {
    caseId: randomUUID(),
    subjectId: randomUUID(),
    actorId: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    actorRole: "subject",
    autonomyLevel: "L1",
    shareScope: {},
    sentenceIndex: 0,
  };
  const output = createSegmentWriter({
    writer: {
      write: (part) => {
        writes.push(part);
      },
    },
    context,
    turnId: randomUUID(),
    language: "de-AT",
    config,
    passages: new Map(),
  });
  output.action({
    id: randomUUID(),
    kind: "caption",
    target: { kind: "ui", elementId: "unsafe-label" },
    sentenceIndex: 0,
    payload: { label: "Nehmen Sie 50 mg." },
  });
  await output.write({ type: "text-start", id: "answer" });
  await output.write({ type: "text-delta", id: "answer", delta: "Hier ist das Dokument." });
  await output.write({ type: "text-end", id: "answer" });
  expect(writes).toEqual([]);
  await output.finish();
  expect(writes).not.toContainEqual(expect.objectContaining({ type: "data-action" }));
  expect(generate).not.toHaveBeenCalled();
});

it("only the final agent step's answer is verified and emitted, while planning prose stays internal", async () => {
  generate.mockResolvedValue({ output: { medicalViolation: false, unsupportedClaim: false } });
  const writes: unknown[] = [];
  const context: RuntimeContext = {
    caseId: randomUUID(),
    subjectId: randomUUID(),
    actorId: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    actorRole: "subject",
    autonomyLevel: "L1",
    shareScope: {},
    sentenceIndex: 0,
  };
  const output = createSegmentWriter({
    writer: {
      write: (part) => {
        writes.push(part);
      },
    },
    context,
    turnId: randomUUID(),
    language: "de-AT",
    config,
    passages: new Map(),
  });
  await output.write({ type: "text-start", id: "planning" });
  await output.write({
    type: "text-delta",
    id: "planning",
    delta: "Intermediate internal planning.",
  });
  await output.write({ type: "text-end", id: "planning" });
  await output.write({ type: "start-step" });
  await output.write({ type: "text-start", id: "final" });
  await output.write({
    type: "text-delta",
    id: "final",
    delta: "Gern helfe ich bei Verwaltungsfragen.",
  });
  await output.write({ type: "text-end", id: "final" });
  await output.finish();
  expect(JSON.stringify(writes)).not.toContain("Intermediate");
  expect(JSON.stringify(writes)).toContain("Verwaltungsfragen");
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({ prompt: expect.not.stringContaining("Intermediate") }),
  );
});

it("the pipeline enforces both merged sets of medical boundary patterns", async () => {
  for (const text of ["Your risk is uncertain.", "Your lab results prove diabetes."]) {
    expect(await guardAnswer(config, text, "en", new Map())).toBe(copyFor("en").handoff);
  }
  expect(generate).not.toHaveBeenCalled();
});

it("an unopened resource offer becomes only the short open question", async () => {
  const writes: { type: string; delta?: string }[] = [];
  const output = createSegmentWriter({
    writer: { write: (part) => void writes.push(part as { type: string; delta?: string }) },
    context: {
      caseId: randomUUID(),
      subjectId: randomUUID(),
      actorId: randomUUID(),
      userId: randomUUID(),
      sessionId: randomUUID(),
      actorRole: "subject",
      autonomyLevel: "L1",
      shareScope: {},
      sentenceIndex: 0,
    },
    turnId: randomUUID(),
    language: "de-AT",
    config,
    passages: new Map(),
  });
  output.offer("das Pflegegeld-Antragsformular");
  await output.write({ type: "text-start", id: "answer" });
  await output.write({
    type: "text-delta",
    id: "answer",
    delta: "Den Antrag stellen Sie bei der Pensionsversicherung. Soll ich ihn öffnen?",
  });
  await output.write({ type: "text-end", id: "answer" });
  await output.finish();
  expect(generate).not.toHaveBeenCalled();
  expect(writes.filter((part) => part.type === "text-delta").map((part) => part.delta)).toEqual([
    "Soll ich das Pflegegeld-Antragsformular für Sie öffnen?",
  ]);
});

it("an unsourced claim loses its text but keeps the pointer for the first sentence", async () => {
  generate.mockResolvedValue({ output: { medicalViolation: false, unsupportedClaim: true } });
  const writes: { type: string; data?: { kind?: string } }[] = [];
  const output = createSegmentWriter({
    writer: { write: (part) => void writes.push(part as { type: string }) },
    context: {
      caseId: randomUUID(),
      subjectId: randomUUID(),
      actorId: randomUUID(),
      userId: randomUUID(),
      sessionId: randomUUID(),
      actorRole: "subject",
      autonomyLevel: "L1",
      shareScope: {},
      sentenceIndex: 0,
    },
    turnId: randomUUID(),
    language: "de-AT",
    config,
    passages: new Map(),
  });
  output.action({
    id: randomUUID(),
    kind: "point",
    target: { kind: "text", quote: "Antrag auf Pflegegeld" },
    sentenceIndex: 0,
    payload: { label: "Hier" },
  });
  await output.write({ type: "text-start", id: "answer" });
  await output.write({ type: "text-delta", id: "answer", delta: "Den Antrag stellen Sie hier." });
  await output.write({ type: "text-end", id: "answer" });
  output.opened();
  await output.finish();
  expect(writes).toContainEqual(
    expect.objectContaining({
      type: "data-action",
      data: expect.objectContaining({ kind: "point" }),
    }),
  );
  expect(writes).toContainEqual(
    expect.objectContaining({
      type: "text-delta",
      delta: "Die Seite ist jetzt geöffnet. Ich zeige Ihnen, wo es steht.",
    }),
  );
});
