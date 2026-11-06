import { expect, test } from "vitest";
import { loadKnowledge } from "../../src/loader/index.ts";
import {
  BenefitSchema,
  LIFE_SITUATION_KEYS,
  lifeSituationKey,
  lifeSituationLabel,
  lifeSituationTerms,
} from "../../src/schemas/index.ts";
import { benefit } from "../loader/fixtures.ts";

test("FR-G5 every catalog record uses only the shared life-situation vocabulary", async () => {
  const knowledge = await loadKnowledge();
  const keys = new Set<string>(LIFE_SITUATION_KEYS);
  for (const record of Object.values(knowledge.catalog)) {
    expect(record.life_situations.length).toBeGreaterThan(0);
    for (const situation of record.life_situations) expect(keys.has(situation)).toBe(true);
  }
  expect(
    BenefitSchema.safeParse({ ...benefit, life_situations: ["nach-dem-spital"] }).success,
  ).toBe(false);
  expect(BenefitSchema.safeParse({ ...benefit, life_situations: [] }).success).toBe(false);
});

test("FR-G5 the after-hospital bundle holds rehabilitation, aids and private-doctor refunds", async () => {
  const knowledge = await loadKnowledge();
  const members = Object.values(knowledge.catalog)
    .filter((record) => record.life_situations.includes("after-hospital"))
    .map((record) => record.id);
  expect(members).toEqual(
    expect.arrayContaining([
      "medical-rehabilitation",
      "heilbehelfe-hilfsmittel",
      "oegk-wahlarzt-kostenerstattung",
    ]),
  );
});

test("FR-G1 earlier spellings and labels resolve to one vocabulary key", () => {
  expect(lifeSituationKey("nach-dem-spital")).toBe("after-hospital");
  expect(lifeSituationKey("Nach dem Spital")).toBe("after-hospital");
  expect(lifeSituationKey("familie-mit-kind")).toBe("family-with-child");
  expect(lifeSituationKey("geringes-einkommen")).toBe("low-income");
  expect(lifeSituationKey("hilfe-im-alltag")).toBe("care");
  expect(lifeSituationKey("CARE")).toBe("care");
  expect(lifeSituationKey("not-in-vocabulary")).toBeUndefined();
  expect(lifeSituationLabel("after-hospital")).toBe("Nach dem Spital");
  expect(lifeSituationLabel("not-in-vocabulary")).toBe("not-in-vocabulary");
  expect(lifeSituationTerms("not-in-vocabulary")).toEqual(["not-in-vocabulary"]);
  expect(lifeSituationTerms("care")).toEqual(
    expect.arrayContaining(["care", "Pflege und Betreuung"]),
  );
});

test("FR-D9 every documented attachment cites one of the record's own sources", async () => {
  const knowledge = await loadKnowledge();
  for (const record of Object.values(knowledge.catalog)) {
    const urls = new Set(record.sources.map((source) => source.url));
    for (const document of record.documents) {
      expect(document.source.quote.trim()).not.toBe("");
      expect(document.obtain_from.trim()).not.toBe("");
      expect(urls.has(document.source.url)).toBe(true);
    }
  }
});
