import { z } from "zod";

const ModelConfigSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  EVAL_JUDGE_MODEL: z.string().trim().min(1).default("gpt-4.1-mini"),
  EVAL_PERSONA_MODEL: z.string().trim().min(1).default("gpt-4.1-mini"),
});

/** Called only when an evaluation needs a provider; the demonstration stays offline. */
export function readModelConfig() {
  return ModelConfigSchema.parse(process.env);
}
