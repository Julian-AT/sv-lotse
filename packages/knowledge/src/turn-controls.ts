import { z } from "zod";
import data from "../data/turn-controls.json" with { type: "json" };

const phrases = z.array(z.string().trim().min(1)).min(1);
export const turnControlPolicy = z
  .strictObject({
    source: z.strictObject({
      uri: z.string().min(1),
      as_of: z.iso.date(),
      quotes: z.array(z.string().min(1)).min(1),
      notes: z.string().min(1),
    }),
    rules: z
      .array(
        z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("autonomy"),
            level: z.enum(["L1", "L2", "L3"]),
            phrases,
          }),
          z.strictObject({
            kind: z.enum(["pause", "confirm", "confirm-autonomy", "decline"]),
            phrases,
          }),
        ]),
      )
      .min(1),
  })
  .parse(data);

export type TurnControlIntent =
  | { kind: "autonomy"; level: "L1" | "L2" | "L3" }
  | { kind: "pause" | "confirm" | "confirm-autonomy" | "decline" };

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("de-AT")
    .trim()
    .replace(/[.!?]+$/u, "")
    .trim()
    .replace(/\s+/gu, " ");
}

/** Whole utterances only: quoted commands, negation and mixed requests grant no authority. */
export function detectTurnControl(text: string): TurnControlIntent | undefined {
  const normalized = normalize(text);
  const rule = turnControlPolicy.rules.find((entry) =>
    entry.phrases.some((phrase) => normalize(phrase) === normalized),
  );
  if (!rule) return undefined;
  return rule.kind === "autonomy" ? { kind: rule.kind, level: rule.level } : { kind: rule.kind };
}
