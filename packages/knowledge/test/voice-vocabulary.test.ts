import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  applyVoiceAliases,
  VoiceVocabularySchema,
  voiceVocabulary,
} from "../src/voice-vocabulary.ts";

test("§12 supplies at most 50 sourced carrier and benefit terms of at most 20 characters", () => {
  const vocabulary = voiceVocabulary("de");
  expect(VoiceVocabularySchema.safeParse(vocabulary).success).toBe(true);
  expect(vocabulary.keyterms).toEqual(
    expect.arrayContaining([
      "ÖGK",
      "SVS",
      "BVAEB",
      "PVA",
      "Pflegegeld",
      "Rehabilitation",
      "Wahlarzt",
    ]),
  );
  expect(new Set(vocabulary.keyterms).size).toBe(vocabulary.keyterms.length);
  expect(vocabulary.keyterms.length).toBeLessThanOrEqual(50);
  expect(vocabulary.keyterms.every((term) => term.length <= 20)).toBe(true);
});

test("FR-C8 restores exact catalog spellings without changing unrelated words or punctuation", () => {
  const { spellingAliases } = voiceVocabulary("de");
  expect(
    applyVoiceAliases("OEGK, S V S, B V A E B und P V A: pflege geld; Wahl Arzt.", spellingAliases),
  ).toBe("ÖGK, SVS, BVAEB und PVA: Pflegegeld; Wahlarzt.");
  const unrelated = "XÖGK ÖGKx APVA PVA2 pflegegeldbezieherin Überweisung 1.234,50 €";
  expect(applyVoiceAliases(unrelated, spellingAliases)).toBe(unrelated);
  expect(applyVoiceAliases("rezept gebühren befreiung", spellingAliases)).toBe(
    "Rezeptgebührenbefreiung",
  );
});

test("§12 pronunciation aliases are language-specific and do not cascade", () => {
  const german = voiceVocabulary("de").pronunciationAliases;
  const english = voiceVocabulary("en").pronunciationAliases;
  expect(german).toHaveLength(4);
  expect(english).toHaveLength(4);
  expect(applyVoiceAliases("ÖGK SVS BVAEB PVA", german)).toBe(
    "Ö Geh Kah Es Fau Es Be Fau A E Be Pe Fau A",
  );
  expect(english).not.toEqual(german);
  expect(
    applyVoiceAliases("a b", [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]),
  ).toBe("b c");
  expect(applyVoiceAliases("nothing", [])).toBe("nothing");
});

test("FR-C8 offline Mac dictation bundles exactly the sourced knowledge vocabulary", async () => {
  const source = await readFile(new URL("../data/voice-vocabulary.json", import.meta.url), "utf8");
  const bundled = await readFile(
    new URL(
      "../../../apps/mac/Packages/LotseKit/Sources/LotseVoice/Resources/voice-vocabulary.json",
      import.meta.url,
    ),
    "utf8",
  );
  expect(bundled).toBe(source);
});
