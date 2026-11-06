import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { type BenefitRecord, findBenefits } from "../../src/engine/catalog.ts";
import { benefitRecordSchema } from "../../src/tools/contracts/records.ts";

const directory = new URL("../../../knowledge/catalog/", import.meta.url);
const records = readdirSync(directory)
  .filter((name) => name.endsWith(".yaml"))
  .map((name) => benefitRecordSchema.parse(parse(readFileSync(new URL(name, directory), "utf8"))));

function fixture(): BenefitRecord {
  const record = records[0];
  const source = record?.sources[0];
  if (!record || !source) throw new Error("Missing sourced catalog");
  // The real catalog does not contain a tiny, complete three-outcome truth table.
  return {
    ...record,
    id: "test-benefit",
    name_de: "Verwaltungsunterstützung",
    name_simple: "Unterlagen vorbereiten",
    life_situations: ["test-situation"],
    criteria: [
      { id: "known", text_de: "Bestätigte Angabe", condition: "confirmed == true", source },
      { id: "missing", text_de: "Offene Angabe", condition: "missing == true", source },
      { id: "negative", text_de: "Abweichende Angabe", condition: "carrier == 'expected'", source },
      { id: "unstructured", text_de: "Mit der Stelle klären", source },
    ],
  };
}

describe("FR-G1/FR-G2 sourced catalog", () => {
  it("matches a life situation and classifies met, unknown and not met without losing sources", () => {
    const record = fixture();
    const [candidate] = findBenefits(
      [record],
      {
        goalText: "Ich brauche Hilfe",
        lifeSituation: "test-situation",
        subject: { carrier: "other" },
      },
      { confirmed: true },
    );
    expect(candidate?.criteria.map((item) => item.status)).toEqual([
      "met",
      "unknown",
      "not_met",
      "unknown",
    ]);
    expect(candidate?.criteria.every((item) => item.sources[0]?.asOf === record.as_of)).toBe(true);
    expect(candidate?.criteria[0]?.sources[0]?.quote).toBe(record.criteria[0]?.source.quote);
  });

  it("matches German goal text without requiring a benefit identifier and ignores unrelated records", () => {
    const record = fixture();
    expect(
      findBenefits([record], { goalText: "Bitte Verwaltungsunterstützung", subject: {} }).map(
        (item) => item.id,
      ),
    ).toEqual([record.id]);
    expect(findBenefits([record], { goalText: "zzzzzzzzz", subject: {} })).toEqual([]);
  });

  it("keeps unreviewed records unreviewed and handles the entire loaded catalog shape", () => {
    expect(records.length).toBeGreaterThan(0);
    const unreviewed = records.find((record) => record.verified_at === undefined);
    expect(unreviewed).toBeDefined();
    expect(benefitRecordSchema.parse(unreviewed).verified_at).toBeUndefined();
  });
});
