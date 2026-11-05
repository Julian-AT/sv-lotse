import { expect, test } from "vitest";
import { judge, loadRubric, scoreSchema } from "../../src/judge/index.ts";
import {
  PersonaResultSchema,
  type SystemUnderTest,
  simulatePersona,
} from "../../src/persona/index.ts";
import { JudgeResultSchema } from "../../src/schema/index.ts";

test("AC4 live judge ranks the clearly good fixed transcript higher on every criterion", async () => {
  const rubric = await loadRubric(new URL("../../rubrics/sample.v1.yaml", import.meta.url));
  const request = {
    role: "user" as const,
    text: "Was ist zwei plus zwei? Bitte antworte kurz auf Deutsch.",
  };
  const good = await judge(
    {
      transcript: [request, { role: "assistant", text: "Zwei plus zwei ist vier." }],
      expected: "The correct answer is four, stated briefly in simple German.",
    },
    rubric,
  );
  const bad = await judge(
    {
      transcript: [
        request,
        { role: "assistant", text: "Two plus two is nine. I will only speak English." },
      ],
      expected: "The correct answer is four, stated briefly in simple German.",
    },
    rubric,
  );
  expect(JudgeResultSchema.parse(good)).toEqual(good);
  expect(JudgeResultSchema.parse(bad)).toEqual(bad);
  expect(scoreSchema(rubric).parse(good.scores)).toEqual(good.scores);
  expect(scoreSchema(rubric).parse(bad.scores)).toEqual(bad.scores);
  for (const criterion of rubric.criteria) {
    const goodScore = good.scores[criterion.id];
    const badScore = bad.scores[criterion.id];
    if (!goodScore || !badScore) throw new Error("Judge omitted a criterion");
    expect(goodScore.score).toBeGreaterThan(badScore.score);
  }
  expect(good.rubricVersion).toBe("1");
  expect(good.model.length).toBeGreaterThan(0);
}, 150_000);

test("AC5 live persona completes a German echo conversation within the turn limit", async () => {
  const system: SystemUnderTest = {
    async startCase() {},
    async sendTurn(text) {
      return { text, events: [] };
    },
  };
  const result = await simulatePersona(
    {
      language: "de",
      age: 65,
      carrier: "synthetischer Träger",
      region: "Wien",
      goal: "Sage genau 'Guten Tag' und höre dieselben Worte vom Gegenüber. Sobald sie zurückkommen, ist dein Ziel erreicht.",
      facts: { greeting: "Guten Tag" },
      style: "kurzes, einfaches Deutsch",
    },
    system,
    { maxTurns: 3 },
  );
  expect(PersonaResultSchema.parse(result)).toEqual(result);
  expect(result.status).toBe("goal_reached");
  expect(result.turns.length).toBeGreaterThan(0);
  expect(result.turns.length).toBeLessThanOrEqual(3);
  expect(result.language).toBe("de");
  expect(result.turns[0]?.user).toContain("Guten Tag");
  expect(result.turns.every((turn) => turn.user === turn.assistant)).toBe(true);
}, 150_000);
