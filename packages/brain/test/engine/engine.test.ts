import { describe, expect, it } from "vitest";
import { evaluateCondition } from "../../src/engine/conditions.ts";
import {
  applyAnswers,
  completeStep,
  GOAL_CONFIRMATION_ACTION,
  nextQuestion,
  openSteps,
  startProcess,
} from "../../src/engine/index.ts";
import { hydrateContext, validSlotValue } from "../../src/engine/slots.ts";
import { contracts, toolNames } from "../../src/tools/contracts/index.ts";
import { corpus, definition, evidence } from "./fixtures.ts";

describe("E1 criteria evaluation", () => {
  it.each([
    ["missing == false", {}, undefined],
    ["false and unknown", {}, false],
    ["true or unknown", {}, true],
    ["not unknown", {}, undefined],
    [
      "age >= 18 and (carrier == 'public' or status == 'active')",
      { age: 19, carrier: "public" },
      true,
    ],
    ["age < 18", { age: 19 }, false],
    ["age >= 18", { age: "19" }, undefined],
    ["residence.confirmed == true", { residence: { confirmed: true } }, true],
    ["residence.confirmed == true", { "residence.confirmed": false }, false],
    ["unknown or false", {}, undefined],
    ["unknown and true", {}, undefined],
    ["not (count != 0)", { count: 0 }, true],
    ["invalid()", {}, undefined],
    ["true junk", {}, undefined],
  ] as const)(
    "evaluates %s without coercing or inventing facts",
    (expression, values, expected) => {
      expect(evaluateCondition(expression, values)).toBe(expected);
    },
  );
});

describe("E1 process engine", () => {
  it("FR-G7 requires goal confirmation and preserves facts when the goal changes", () => {
    const process = definition();
    expect(() => startProcess(process, "  ")).toThrow("GOAL_CONFIRMATION_REQUIRED");
    const first = startProcess(process, "Antrag vorbereiten", { "residence.region": "Wien" });
    expect(first.values.region).toBe("Wien");
    expect(startProcess(process, first.goal, {}, first)).toBe(first);
    const replanned = startProcess(
      process,
      "Andere Unterlagen vorbereiten",
      {},
      { ...first, asked: ["accepted"], completed: ["intake"] },
    );
    expect(replanned.values.region).toBe("Wien");
    expect(replanned.completed).toEqual([]);
    expect(replanned.asked).toContain("accepted");
  });

  it("FR-G7 completes a goal-confirmation step from the confirmed goal without surfacing a tool", () => {
    const process = definition();
    process.steps = [
      {
        id: "confirm",
        needs: [],
        action: GOAL_CONFIRMATION_ACTION,
        transitions: [{ to: "intake" }],
      },
      { id: "intake", needs: ["confirm", "accepted"] },
    ];
    const state = startProcess(process, "Antrag vorbereiten");
    expect(state.completed).toEqual(["confirm"]);
    expect(openSteps(process, state).map((step) => step.id)).toEqual(["intake"]);
    const next = nextQuestion(process, state);
    expect(next.step?.id).toBe("intake");
    expect(next.slotId).toBe("accepted");
    expect(completeStep(process, state, "confirm", undefined)).toEqual(state);
  });

  it("FR-G3 asks only a missing slot on an active step and never asks it twice", () => {
    const process = definition();
    const initial = startProcess(process, "Antrag vorbereiten");
    const first = nextQuestion(process, initial);
    expect(first.slotId).toBe("accepted");
    expect(first.missingSlots).toEqual(["accepted", "region"]);
    expect(initial.asked).toEqual([]);
    const second = nextQuestion(process, first.state);
    expect(second.slotId).toBe("region");
    const third = nextQuestion(process, second.state);
    expect(third.slotId).toBeNull();
    expect(third.missingSlots).toEqual(["accepted", "region"]);
    expect(third.state.asked).toEqual(["accepted", "region"]);
  });

  it("FR-G3 prioritizes the missing slot that unlocks the most remaining steps", () => {
    const process = definition();
    process.steps = [
      { id: "short", needs: ["accepted"] },
      { id: "long", needs: ["region"] },
      { id: "dependent", needs: ["long"] },
    ];
    expect(nextQuestion(process, startProcess(process, "Antrag vorbereiten")).slotId).toBe(
      "region",
    );
  });

  it("FR-G3 completes a ready step before asking about a different step", () => {
    const process = definition();
    process.steps = [
      { id: "ready", needs: [] },
      { id: "waiting", needs: ["region"] },
    ];
    const next = nextQuestion(process, startProcess(process, "Antrag vorbereiten"));
    expect(next.step?.id).toBe("ready");
    expect(next.slotId).toBeNull();
    expect(next.state.asked).toEqual([]);
  });

  it("FR-G3 fills newly available confirmed context without asking for it", () => {
    const process = definition();
    const initial = startProcess(process, "Antrag vorbereiten");
    const hydrated = hydrateContext(process, initial, { "residence.region": "Wien" });
    expect(hydrated.values.region).toBe("Wien");
    expect(nextQuestion(process, hydrated).missingSlots).toEqual(["accepted"]);
    expect(initial.values).toEqual({});
  });

  it("E1 reopens a clarification loop without replaying old transitions or repeating questions", () => {
    const process = definition();
    process.steps = [
      {
        id: "entry",
        needs: ["accepted"],
        transitions: [
          { to: "clarify", when: "accepted == false" },
          { to: "finish", when: "accepted == true" },
        ],
      },
      { id: "clarify", needs: [], transitions: [{ to: "entry" }] },
      { id: "finish", needs: [] },
    ];
    let state = nextQuestion(process, startProcess(process, "Antrag vorbereiten")).state;
    state = applyAnswers(process, state, [{ id: "accepted", value: false }]).state;
    state = completeStep(process, state, "entry", evidence);
    state = completeStep(process, state, "clarify", evidence);
    expect(openSteps(process, state).map((step) => step.id)).toEqual(["entry"]);
    expect(nextQuestion(process, state).slotId).toBeNull();
    state = applyAnswers(process, state, [{ id: "accepted", value: true }]).state;
    state = completeStep(process, state, "entry", evidence);
    expect(openSteps(process, state).map((step) => step.id)).toEqual(["finish"]);
    expect(state.asked).toEqual(["accepted"]);
  });

  it.each([true, false])(
    "E1 follows only the matching branch when the answer is %s",
    (accepted) => {
      const process = definition();
      let state = startProcess(process, "Antrag vorbereiten");
      state = applyAnswers(process, state, [
        { id: "accepted", value: accepted },
        { id: "region", value: "Wien" },
      ]).state;
      const before = structuredClone(state);
      state = completeStep(process, state, "intake", evidence);
      expect(before.completed).toEqual([]);
      expect(openSteps(process, state).map((step) => step.id)).toEqual([
        accepted ? "prepare" : "contact",
      ]);
      expect(state.activated).not.toContain(accepted ? "contact" : "prepare");
      if (accepted)
        state = applyAnswers(process, state, [{ id: "name", value: "Testperson" }]).state;
      state = completeStep(process, state, accepted ? "prepare" : "contact", evidence);
      expect(openSteps(process, state).map((step) => step.id)).toEqual(["finish"]);
      state = completeStep(process, state, "finish", evidence);
      expect(openSteps(process, state)).toEqual([]);
      expect(completeStep(process, state, "finish", undefined)).toEqual(state);
    },
  );

  it("E1 rejects premature steps, unsupported evidence, invalid answers and cyclic dependencies", () => {
    const process = definition();
    const state = startProcess(process, "Antrag vorbereiten");
    expect(() => completeStep(process, state, "finish", evidence)).toThrow("STEP_NOT_READY");
    const applied = applyAnswers(process, state, [
      { id: "accepted", value: "true" },
      { id: "region", value: "Invalid" },
      { id: "unknown", value: true },
      { id: "name", value: "A" },
    ]);
    expect(applied.validationErrors).toHaveLength(4);
    expect(applied.state.values).toEqual({});
    const ready = applyAnswers(process, state, [
      { id: "accepted", value: false },
      { id: "region", value: "Wien" },
    ]).state;
    expect(() => completeStep(process, ready, "intake", undefined)).toThrow("INVALID_EVIDENCE");
    expect(() => completeStep(process, ready, "intake", { type: "user_statement" })).toThrow(
      "INVALID_EVIDENCE",
    );
    process.steps = [
      { id: "a", needs: ["b"] },
      { id: "b", needs: ["a"] },
    ];
    expect(() => startProcess(process, "Antrag vorbereiten")).toThrow("INVALID_DEFINITION");
  });

  it("E1 validates calendar dates, bounded numbers, patterns and falsy answers", () => {
    expect(validSlotValue({ id: "date", type: "date", question_hint: "Datum" }, "2026-02-30")).toBe(
      false,
    );
    const slot = {
      id: "count",
      type: "number",
      question_hint: "Anzahl",
      validation: { min: 0, max: 7 },
    };
    expect(validSlotValue(slot, 0)).toBe(true);
    expect(validSlotValue(slot, 8)).toBe(false);
    expect(
      validSlotValue(
        { id: "code", type: "string", question_hint: "Code", validation: { pattern: "^[A-Z]+$" } },
        "abc",
      ),
    ).toBe(false);
  });

  it.each(corpus.map((process) => [process.id, process] as const))(
    "E1 %s names only registered server tools or the pipeline goal confirmation",
    (_, process) => {
      const server = new Set<string>(
        toolNames.filter((name) => contracts[name].location === "server"),
      );
      for (const step of process.steps) {
        for (const tool of [...(step.action ? [step.action] : []), ...(step.on_complete ?? [])]) {
          expect(tool === GOAL_CONFIRMATION_ACTION || server.has(tool), tool).toBe(true);
        }
      }
    },
  );

  it.each(corpus.map((process) => [process.id, process] as const))(
    "E1 loads %s and exhausts initial questions without repeats",
    (_, process) => {
      let state = startProcess(process, "Verwaltungsanliegen klären");
      const seen = new Set<string>();
      for (let index = 0; index <= process.slots.length; index++) {
        const question = nextQuestion(process, state);
        state = question.state;
        if (!question.slotId) break;
        expect(seen.has(question.slotId)).toBe(false);
        seen.add(question.slotId);
        expect(question.missingSlots).toContain(question.slotId);
      }
      expect(nextQuestion(process, state).slotId).toBeNull();
    },
  );
});
