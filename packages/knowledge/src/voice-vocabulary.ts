import { z } from "zod";
import vocabulary from "../data/voice-vocabulary.json" with { type: "json" };
import { VOICE_VOCABULARY_CONFIG } from "./config.ts";

export const VoiceAliasSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type VoiceAlias = z.infer<typeof VoiceAliasSchema>;
export const VoiceVocabularySchema = z.object({
  keyterms: z
    .array(z.string().min(1).max(VOICE_VOCABULARY_CONFIG.maximumKeytermCharacters))
    .max(VOICE_VOCABULARY_CONFIG.maximumKeyterms),
  spellingAliases: z.array(VoiceAliasSchema),
  pronunciationAliases: z.array(VoiceAliasSchema),
});
export type VoiceVocabulary = z.infer<typeof VoiceVocabularySchema>;
const catalog = z
  .object({
    as_of: z.iso.date(),
    terms: z.array(
      z.object({
        canonical: z.string().min(1),
        variants: z.array(z.string().min(1)),
        pronunciation: z.object({ de: z.string().min(1), en: z.string().min(1) }).optional(),
        sources: z.array(z.object({ url: z.url(), quote: z.string().min(1) })).min(1),
      }),
    ),
  })
  .parse(vocabulary);

/** A compact source-backed catalog shared by realtime recognition and local dictation. */
export function voiceVocabulary(language: "de" | "en"): VoiceVocabulary {
  return VoiceVocabularySchema.parse({
    keyterms: [...new Set(catalog.terms.map((term) => term.canonical))]
      .filter((term) => [...term].length <= VOICE_VOCABULARY_CONFIG.maximumKeytermCharacters)
      .slice(0, VOICE_VOCABULARY_CONFIG.maximumKeyterms),
    spellingAliases: catalog.terms.flatMap((term) =>
      [term.canonical, ...term.variants].map((from) => ({ from, to: term.canonical })),
    ),
    pronunciationAliases: catalog.terms.flatMap((term) =>
      term.pronunciation ? [{ from: term.canonical, to: term.pronunciation[language] }] : [],
    ),
  });
}

/** Exact whole-term replacements only: no fuzzy edits to the user's meaning. */
export function applyVoiceAliases(text: string, aliases: readonly VoiceAlias[]): string {
  const replacements = new Map(aliases.map((alias) => [alias.from.toLocaleLowerCase(), alias.to]));
  const alternatives = [...replacements.keys()]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (alternatives.length === 0) return text;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  return text.replace(pattern, (match) => replacements.get(match.toLocaleLowerCase()) ?? match);
}
