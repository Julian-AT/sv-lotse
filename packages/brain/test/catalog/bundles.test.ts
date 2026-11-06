import { readFile } from "node:fs/promises";
import type { Fact } from "@lotse/protocol";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { contracts } from "../../src/tools/contracts/index.ts";
import { benefitRecordSchema } from "../../src/tools/contracts/records.ts";
import {
  assembleBundles,
  type BenefitRecord,
  projectBundles,
} from "../../src/tools/impl/catalog/bundles.ts";
import { programmeGuidance } from "../../src/tools/impl/catalog/prevention.ts";

async function record(name: string): Promise<BenefitRecord> {
  return benefitRecordSchema.parse(
    parse(
      await readFile(new URL(`../../../knowledge/catalog/${name}.yaml`, import.meta.url), "utf8"),
    ),
  );
}
const input = { goalText: "Angebote finden", subject: {} };
const fact = (type: string, value: Fact["value"], confirmed = true): Fact => ({
  id: `fact-${type}`,
  subjectId: "person",
  type,
  value,
  confirmed,
  confidence: 1,
  source: { kind: "statement", quote: "Bestätigte Angabe" },
});

describe("FR-G5 data-driven bundles", () => {
  test("groups a newly declared life situation inside and outside social insurance without code changes", async () => {
    // Construct a new situation from sourced real records to prove generalization beyond the seed catalog.
    const inside = {
      ...(await record("praevention-vorsorgeuntersuchung")),
      life_situations: ["fixture-new-situation"],
    };
    const outside = {
      ...(await record("familie-familienbeihilfe")),
      life_situations: ["fixture-new-situation"],
    };
    const bundles = assembleBundles([outside, inside], {
      ...input,
      lifeSituation: "fixture-new-situation",
    });
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.socialInsurance.map((entry) => entry.id)).toEqual([inside.id]);
    expect(bundles[0]?.outsideSocialInsurance.map((entry) => entry.id)).toEqual([outside.id]);
    expect(contracts["catalog.findBenefits"].output.parse(projectBundles(bundles))).toHaveLength(2);
  });

  test("ranks matching offers and evaluates sourced conditions while retaining the whole bundle", async () => {
    const original = await record("praevention-vorsorgeuntersuchung");
    const source = original.sources[0];
    if (!source) throw new Error("Missing sourced catalog record");
    // Sourced records extended with conditions cover all three outcomes inside one complete bundle.
    const preferred: BenefitRecord = {
      ...original,
      id: "z-preferred",
      name_de: "Verwaltungsunterstützung",
      name_simple: "Unterlagen vorbereiten",
      life_situations: ["fixture-situation"],
      criteria: [
        { id: "known", text_de: "Bestätigte Angabe", condition: "confirmed == true", source },
        {
          id: "negative",
          text_de: "Abweichende Angabe",
          condition: "carrier == 'expected'",
          source,
        },
        { id: "draft", text_de: "Unbestätigte Angabe", condition: "draft == true", source },
        { id: "missing", text_de: "Offene Angabe", condition: "missing == true", source },
      ],
    };
    const other = { ...original, id: "a-other", life_situations: preferred.life_situations };
    const results = projectBundles(
      assembleBundles(
        [other, preferred],
        { goalText: "Verwaltungsunterstützung", subject: { carrier: "other" } },
        [fact("confirmed", true), fact("draft", true, false)],
      ),
    );
    expect(results.map((entry) => entry.id)).toEqual([preferred.id, other.id]);
    expect(results[0]?.criteria.slice(0, 4).map((entry) => entry.status)).toEqual([
      "met",
      "not_met",
      "unknown",
      "unknown",
    ]);
    expect(results[0]?.criteria[0]?.sources[0]?.quote).toBe(source.quote);
    expect(results[0]?.description).toContain("Sozialversicherung");
    expect(results[0]?.description).toContain(preferred.criteria[0]?.text_de);
    contracts["catalog.findBenefits"].output.parse(results);
  });

  test("FR-G4 carries each criterion's wording, legal basis and the offer scope for the Why panel", async () => {
    const original = await record("familie-familienbeihilfe");
    const withBasis = original.criteria.find((criterion) => criterion.legal_basis);
    if (!withBasis) throw new Error("Missing catalog criterion with a legal basis");
    const [result] = projectBundles(
      assembleBundles([original], { ...input, lifeSituation: original.life_situations[0] }),
    );
    expect(result?.scope).toBe(original.scope);
    expect(result?.criteria.find((criterion) => criterion.id === withBasis.id)).toMatchObject({
      text: withBasis.text_de,
      legalBasis: withBasis.legal_basis,
    });
    contracts["catalog.findBenefits"].output.parse(result ? [result] : []);
  });

  test("keeps all records in the requested situation regardless of the administering carrier", async () => {
    const records = await Promise.all(
      [
        "pflegegeld",
        "pflegeberatung-wien",
        "pflege-mobile-dienste-wien",
        "pflegekarenz",
        "pflege-24-stunden-betreuung",
      ].map(record),
    );
    const results = projectBundles(
      assembleBundles(records, { ...input, lifeSituation: "care", subject: { carrier: "oegk" } }),
    );
    expect(results).toHaveLength(records.length);
    expect(results.every((entry) => entry.sources.length > 0)).toBe(true);
    expect(
      assembleBundles(records, { ...input, lifeSituation: "not-in-catalog" })[0]
        ?.outsideSocialInsurance,
    ).toEqual([]);
  });

  test("assembles the after-hospital bundle from vocabulary keys, labels and earlier spellings", async () => {
    const records = await Promise.all(
      [
        "medical-rehabilitation",
        "heilbehelfe-hilfsmittel",
        "oegk-wahlarzt-kostenerstattung",
        "pflegegeld",
        "praevention-vorsorgeuntersuchung",
      ].map(record),
    );
    const expected = [
      "heilbehelfe-hilfsmittel",
      "medical-rehabilitation",
      "oegk-wahlarzt-kostenerstattung",
    ];
    for (const lifeSituation of ["after-hospital", "nach-dem-spital", "Nach dem Spital"]) {
      const bundles = assembleBundles(records, { ...input, lifeSituation });
      expect(bundles.map((bundle) => bundle.lifeSituation)).toEqual(["after-hospital"]);
      expect(
        projectBundles(bundles)
          .map((entry) => entry.id)
          .sort(),
      ).toEqual(expected);
      expect(bundles[0]?.socialInsurance[0]?.description).toContain(
        "Lebenssituation: Nach dem Spital (after-hospital).",
      );
    }
    const spoken = assembleBundles(records, {
      ...input,
      goalText: "Ich komme gerade aus dem Spital",
    });
    expect(spoken.map((bundle) => bundle.lifeSituation)).toContain("after-hospital");
    expect(spoken.map((bundle) => bundle.lifeSituation)).not.toContain("prevention");
  });

  test("expands a matching offer to its complete situation bundle and deduplicates shared offers", async () => {
    const records = await Promise.all(
      [
        "praevention-vorsorgeuntersuchung",
        "praevention-bewegt-im-park",
        "familie-familienbeihilfe",
      ].map(record),
    );
    const bundles = assembleBundles(records, { ...input, goalText: "Vorsorgeuntersuchung" });
    const results = projectBundles(bundles);
    expect(results.map((entry) => entry.id)).toContain("praevention-bewegt-im-park");
    expect(results.map((entry) => entry.id)).not.toContain("familie-familienbeihilfe");
    const all = projectBundles(assembleBundles(records, input));
    expect(new Set(all.map((entry) => entry.id)).size).toBe(all.length);
  });
});

describe("FR-G6 published target groups", () => {
  test.each([
    ["44", "not_met"],
    ["45", "met"],
    ["74", "met"],
    ["75", "not_met"],
    ["40-49", "unknown"],
    ["65+", "unknown"],
    ["adult", "unknown"],
  ])("matches age band %s conservatively as %s", async (ageBand, expected) => {
    const programme = await record("praevention-brustkrebs-frueherkennung");
    const guidance = programmeGuidance(programme, ageBand, [fact("sex", "female")]);
    expect(guidance.criteria.find((entry) => entry.id.endsWith(":age"))?.status).toBe(expected);
    expect(guidance.criteria.find((entry) => entry.id.endsWith(":sex"))?.status).toBe("met");
    expect(guidance.sources).toContainEqual(
      expect.objectContaining({ quote: programme.target_group?.rationale_text }),
    );
    expect(guidance.text.join(" ")).toContain("24 Monate");
  });

  test("does not resolve conflicting or unconfirmed facts into a confident match", async () => {
    const programme = await record("praevention-brustkrebs-frueherkennung");
    const guidance = programmeGuidance(programme, "50", [
      fact("age", 30),
      fact("age", 50),
      fact("sex", "female", false),
    ]);
    expect(guidance.criteria.find((entry) => entry.id.endsWith(":age"))?.status).toBe("unknown");
    expect(guidance.criteria.find((entry) => entry.id.endsWith(":sex"))?.status).toBe("unknown");
  });

  test("only mentions family history when published and leaves individual decisions to the doctor", async () => {
    const breast = await record("praevention-brustkrebs-frueherkennung");
    const vu = await record("praevention-vorsorgeuntersuchung");
    const facts = [fact("family_history", true)];
    expect(programmeGuidance(vu, "50", facts).text.join(" ")).not.toContain("Familienanamnese");
    const guidance = programmeGuidance(breast, "35", facts);
    expect(guidance.criteria.find((entry) => entry.id.endsWith(":family-history"))?.status).toBe(
      "unknown",
    );
    expect(guidance.text.join(" ")).toContain("Arzttermin vorbereitet");
    expect(guidance.text.join(" ")).not.toMatch(/Ihr Risiko|Sie benötigen|dringend|\d+\s*%/);
  });

  test("matches a confirmed published family criterion without deciding an earlier screening start", async () => {
    const programme = await record("praevention-brustkrebs-frueherkennung");
    const published = programme.target_group?.family_history_criteria?.[0];
    if (!published) throw new Error("Missing published criterion");
    const guidance = programmeGuidance(programme, "35", [fact("family_history", published)]);
    expect(guidance.criteria.find((entry) => entry.id.endsWith(":family-history"))?.status).toBe(
      "met",
    );
    expect(guidance.criteria.find((entry) => entry.id.endsWith(":age"))?.status).toBe("not_met");
    expect(guidance.text.join(" ")).toContain(
      "Ein früherer Beginn und individuelle Entscheidungen",
    );
    const unconfirmed = programmeGuidance(programme, "35", [
      fact("family_history", published, false),
    ]);
    expect(unconfirmed.criteria.find((entry) => entry.id.endsWith(":family-history"))?.status).toBe(
      "unknown",
    );
  });

  test("preserves both pages of real vaccination quotes without calculating protection or due dates", async () => {
    const programme = await record("praevention-oeffentliches-impfprogramm");
    const gold = JSON.parse(
      await readFile(new URL("../../../evals/sets/e12/gold.json", import.meta.url), "utf8"),
    ) as {
      cases: {
        tags: string[];
        expected: { annotations: { factType: string; quote: string; page: number }[] };
      }[];
    };
    const annotations = gold.cases
      .flatMap((entry) => entry.expected.annotations)
      .filter((entry) => entry.factType === "vaccination_record");
    const facts = annotations.map(
      (entry, index): Fact => ({
        ...fact("vaccination_record", entry.quote),
        id: `entry-${index}`,
        source: {
          kind: "document",
          documentId: "imported-pass",
          page: entry.page,
          quote: entry.quote,
        },
      }),
    );
    expect(facts).toHaveLength(9);
    const results = projectBundles(
      assembleBundles([programme], input, facts, new Set([programme.id])),
    );
    const result = results[0];
    for (const entry of annotations)
      expect(result?.sources).toContainEqual(
        expect.objectContaining({
          quote: entry.quote,
          url: `document:imported-pass#page=${entry.page}`,
        }),
      );
    expect(result?.description).toContain("Vollständigkeit, Impfschutz");
    expect(result?.description).not.toMatch(/Sie sind geschützt|Auffrischung ist fällig/);
    contracts["catalog.findBenefits"].output.parse(results);
  });

  test("does not infer vaccination status from missing, unconfirmed or unsourced entries", async () => {
    const programme = await record("praevention-oeffentliches-impfprogramm");
    const facts = [
      fact("vaccination_record", "Unbestätigt", false),
      fact("vaccination_record", "Selbstauskunft"),
    ];
    const result = projectBundles(
      assembleBundles([programme], input, facts, new Set([programme.id])),
    )[0];
    expect(result?.description).toContain("keine bestätigten Impfeinträge");
    expect(result?.description).not.toContain("Selbstauskunft");
    expect(result?.description).not.toContain("Unbestätigt");
  });
});
