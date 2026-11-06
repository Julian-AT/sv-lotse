import { expect, it } from "vitest";
import { parseBrainConfig } from "../../src/config/index.ts";
import { classifyInput } from "../../src/pipeline/classify.ts";
import { loadEnvironment } from "../runtime/helpers.ts";

loadEnvironment();
it("FR-D3 an application based on a documented recommendation stays administrative", async () => {
  if (process.env.RUN_LIVE !== "1") throw new Error("RUN_LIVE_REQUIRED");
  const config = parseBrainConfig();
  const result = await classifyInput(
    config,
    "Ich möchte den Antrag auf medizinische Rehabilitation anhand der dokumentierten Empfehlung im Entlassungsbrief vorbereiten. Es geht nur um die Verwaltung, nicht um medizinische Beurteilung.",
    "de",
  );
  expect(result.intent).toBe("administrative");
  const confirmation = await classifyInput(
    config,
    "Ja, genau das ist mein Ziel.",
    "de",
    "Einen Antrag auf medizinische Rehabilitation vorbereiten",
  );
  expect(confirmation.confirmsPendingGoal).toBe(true);
  const clinical = await classifyInput(
    config,
    "Welche Therapie ist aufgrund meiner Befunde für mich besser?",
    "de",
  );
  expect(clinical.intent).toBe("medical");
  expect(clinical.candidateGoal).toBeNull();
});
