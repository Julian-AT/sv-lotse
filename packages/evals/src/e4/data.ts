import { resolve } from "node:path";
import { z } from "zod";
import { checkGold, jsonFile, SETS } from "../baseline/data.ts";
import { loadRubric, type Rubric } from "../judge/index.ts";
import { PersonaSpecSchema } from "../persona/index.ts";
import { CaseSchema, type EvalCase } from "../schema/index.ts";

export const ScenarioSchema = z.enum(["s1", "s2", "s3", "s4", "s5"]);
export type Scenario = z.infer<typeof ScenarioSchema>;
const text = z.string().trim().min(1);
export const ScenarioInputSchema = z.object({
  persona: PersonaSpecSchema,
  opening: text.optional(),
  openingUtterance: text.optional(),
  utterance: text.optional(),
  interaction: z
    .object({
      role: z.enum(["subject", "helper"]),
      channel: z.enum(["text", "voice_captions"]),
      availablePages: z.array(z.int().positive()).min(1),
    })
    .optional(),
  document: z
    .object({ path: text, sha256: text.regex(/^[a-f0-9]{64}$/), pageCount: z.int().positive() })
    .optional(),
});
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;
export interface ScenarioData {
  scenario: Scenario;
  cases: EvalCase[];
  rubric: Rubric;
  sources: z.infer<ReturnType<typeof z.json>>;
}
export function openingFor(input: ScenarioInput): string {
  const opening = input.openingUtterance ?? input.utterance ?? input.opening;
  if (!opening) throw new Error("missing_opening");
  return opening;
}
export function actorRoleFor(input: ScenarioInput): "subject" | "helper" {
  if (input.interaction) return input.interaction.role;
  const facts = input.persona.facts;
  const actor = z.object({ role: z.string() }).safeParse(facts.actor);
  const helper = z.object({ name: z.string() }).safeParse(facts.helper);
  return facts.actor === "helper" ||
    actor.data?.role === "helper" ||
    ["helper", "grandparent", "aunt"].includes(String(facts.actorRole)) ||
    (helper.success && facts.speaker === helper.data.name)
    ? "helper"
    : "subject";
}
export async function loadScenarios(scenarios: readonly Scenario[]): Promise<ScenarioData[]> {
  const data = await Promise.all(
    scenarios.map(async (scenario): Promise<ScenarioData> => {
      const directory = resolve(SETS, "e4", ScenarioSchema.parse(scenario));
      const cases = z.array(CaseSchema).parse(await jsonFile(resolve(directory, "cases.json")));
      for (const item of cases) openingFor(ScenarioInputSchema.parse(item.input));
      return {
        scenario,
        cases,
        rubric: await loadRubric(resolve(directory, "rubric.v1.yaml")),
        sources: z.json().parse(await jsonFile(resolve(directory, "sources.json"))),
      };
    }),
  );
  await checkGold(data.flatMap((slice) => slice.cases));
  return data;
}
