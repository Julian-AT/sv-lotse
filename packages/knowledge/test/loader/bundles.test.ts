import { expect, test } from "vitest";
import { loadKnowledge } from "../../src/loader/index.ts";

test("FR-G5 all care, prevention and family offers load with resolvable processes and sourced criteria", async () => {
  const knowledge = await loadKnowledge();
  for (const situation of ["care", "prevention", "family-with-child"] as const) {
    const offers = Object.values(knowledge.catalog).filter((offer) =>
      offer.life_situations.includes(situation),
    );
    expect(offers.length).toBeGreaterThan(4);
    expect(offers.some((offer) => offer.scope === "social_insurance")).toBe(true);
    expect(offers.some((offer) => offer.scope !== "social_insurance")).toBe(true);
    for (const offer of offers) {
      const process = knowledge.resolve(offer.process);
      expect(process).toBeDefined();
      for (const criterion of offer.criteria) expect(criterion.source.quote.trim()).not.toBe("");
      for (const rule of offer.office_rules) expect(knowledge.resolve(rule.office)).toBeDefined();
    }
  }
});

test("FR-G6 programme target groups preserve their published rationale and source", async () => {
  const knowledge = await loadKnowledge();
  const programmes = Object.values(knowledge.catalog).filter((offer) => offer.target_group);
  expect(programmes.length).toBeGreaterThanOrEqual(8);
  for (const programme of programmes) {
    expect(programme.target_group?.rationale_text).toBe(
      programme.target_group?.rationale_source.quote,
    );
    expect(
      programme.sources.some(
        (source) => source.url === programme.target_group?.rationale_source.url,
      ),
    ).toBe(true);
  }
  const passOffers = Object.values(knowledge.processes).filter((process) =>
    process.slots.some((slot) => slot.type === "fact:vaccination_record"),
  );
  expect(passOffers.length).toBeGreaterThanOrEqual(2);
});
