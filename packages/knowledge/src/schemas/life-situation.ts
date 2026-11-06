import { z } from "zod";

/**
 * The one shared life-situation vocabulary (FR-G1, FR-G5). Catalog records tag themselves with these
 * keys; the classifier and bundle matching read them from here. Labels are German display text;
 * aliases are earlier catalog spellings and everyday wording that resolve to a key, never new keys.
 * Add a key here before tagging a record with a new situation.
 */
export const lifeSituationVocabulary = {
  care: {
    label_de: "Pflege und Betreuung",
    aliases: ["hilfe-im-alltag", "pflege", "betreuung"],
  },
  "after-hospital": {
    label_de: "Nach dem Spital",
    aliases: ["nach-dem-spital", "rehabilitation", "spital", "krankenhaus", "entlassung"],
  },
  illness: {
    label_de: "Krankheit und Behandlung",
    aliases: ["krankheit", "krankenstand", "behandlung"],
  },
  prevention: {
    label_de: "Vorsorge und Prävention",
    aliases: ["vorsorge", "praevention"],
  },
  "family-with-child": {
    label_de: "Familie mit Kind",
    aliases: ["familie-mit-kind", "familie", "kind"],
  },
  "low-income": {
    label_de: "Geringes Einkommen",
    aliases: ["geringes-einkommen"],
  },
  disability: {
    label_de: "Behinderung",
    aliases: ["behinderung"],
  },
  unemployment: {
    label_de: "Arbeitslosigkeit",
    aliases: ["arbeitslosigkeit", "arbeitslos"],
  },
  retirement: {
    label_de: "Pension und Ruhestand",
    aliases: ["ruhestand"],
  },
  uninsured: {
    label_de: "Ohne Krankenversicherung",
    aliases: ["selbstversicherung"],
  },
} as const satisfies Record<string, { label_de: string; aliases: readonly string[] }>;

export type LifeSituation = keyof typeof lifeSituationVocabulary;
export const LIFE_SITUATION_KEYS = Object.keys(lifeSituationVocabulary) as [
  LifeSituation,
  ...LifeSituation[],
];
export const LifeSituationSchema = z.enum(LIFE_SITUATION_KEYS);

function normalizedSituation(value: string): string {
  return value
    .toLocaleLowerCase("de-AT")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replaceAll("ß", "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

const lookup = new Map<string, LifeSituation>();
for (const key of LIFE_SITUATION_KEYS) {
  const entry = lifeSituationVocabulary[key];
  for (const term of [key, entry.label_de, ...entry.aliases])
    lookup.set(normalizedSituation(term), key);
}

/** Resolves a key, label or alias to its vocabulary key; unknown wording stays unresolved. */
export function lifeSituationKey(value: string): LifeSituation | undefined {
  return lookup.get(normalizedSituation(value));
}

/** Label of a known key, otherwise the value itself. */
export function lifeSituationLabel(value: string): string {
  const key = lifeSituationKey(value);
  return key ? lifeSituationVocabulary[key].label_de : value;
}

/** Key, label and aliases used for word matching; unknown situations match only themselves. */
export function lifeSituationTerms(value: string): string[] {
  const key = lifeSituationKey(value);
  if (!key) return [value];
  const entry = lifeSituationVocabulary[key];
  return [key, entry.label_de, ...entry.aliases];
}
