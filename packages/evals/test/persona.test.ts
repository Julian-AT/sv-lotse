import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PersonaResultSchema,
  type SystemUnderTest,
  simulatePersona,
} from "../src/persona/index.ts";

const { modelCall } = vi.hoisted(() => ({ modelCall: vi.fn() }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: modelCall,
}));
const spec = {
  language: "de",
  age: 65,
  carrier: "synthetic carrier",
  region: "Wien",
  goal: "Have my greeting echoed",
  facts: { greeting: "Guten Tag" },
  style: "simple language",
};
const reply = (action: string, text = "") => ({
  output: { action, text },
  response: { modelId: "test-persona-v1" },
});
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "unit-test-key");
  modelCall.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function echo(): SystemUnderTest {
  return {
    async startCase() {},
    async sendTurn(text) {
      return { text, events: [] };
    },
  };
}

test("persona stops at goal reached and records validated German turns and model version", async () => {
  modelCall
    .mockResolvedValueOnce(reply("say", "Guten Tag"))
    .mockResolvedValueOnce(reply("goal_reached"));
  const result = await simulatePersona(spec, echo(), { maxTurns: 2 });
  expect(result.status).toBe("goal_reached");
  expect(result.turns).toEqual([{ user: "Guten Tag", assistant: "Guten Tag", events: [] }]);
  expect(result.model).toBe("test-persona-v1");
  expect(PersonaResultSchema.parse(result)).toEqual(result);
});

test("persona enforces turn limit and can give up", async () => {
  modelCall.mockResolvedValue(reply("say", "Guten Tag"));
  const limited = await simulatePersona(spec, echo(), { maxTurns: 2 });
  expect(limited.status).toBe("turn_limit");
  expect(limited.turns).toHaveLength(2);
  modelCall.mockReset().mockResolvedValue(reply("give_up"));
  expect((await simulatePersona(spec, echo(), { maxTurns: 2 })).status).toBe("give_up");
});

test("persona rejects invalid replies and cannot claim success before talking to the system", async () => {
  modelCall.mockResolvedValue(reply("goal_reached"));
  await expect(simulatePersona(spec, echo())).rejects.toThrow("before a system reply");
  modelCall.mockResolvedValue(reply("say", ""));
  await expect(simulatePersona(spec, echo())).rejects.toThrow();
  modelCall.mockResolvedValue(reply("say", "Guten Tag"));
  const invalid: SystemUnderTest = {
    async startCase() {},
    async sendTurn() {
      return { text: "", events: [] };
    },
  };
  await expect(simulatePersona(spec, invalid)).rejects.toThrow();
});
