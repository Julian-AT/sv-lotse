import { expect, test, vi } from "vitest";
import { verifyCitation } from "../../src/guards/citations.ts";
import { dropUnsupportedSentences } from "../../src/pipeline/compose.ts";
import {
  amountsAppearIn,
  asksForAmount,
  moneyAmounts,
  rankForAmounts,
} from "../../src/retrieval/amounts.ts";

// Verbatim excerpts of the indexed sources (Sozialministerium Pflegegeld page, § 5 BPGG, ÖGK).
const table = {
  id: "pflegegeld-table",
  url: "https://www.sozialministerium.gv.at/Themen/Pflege/Pflegegeld.html",
  text: [
    "# Pflegegeld",
    "",
    "## Höhe des Pflegegeldes",
    "",
    "| Pflegebedarf in Stunden pro Monat | Stufe | Betrag in Euro (monatlich, 2026) |",
    "| --- | --- | --- |",
    "| mehr als 65 Stunden | 1 | 206,20 |",
    "| mehr als 95 Stunden | 2 | 380,30 |",
    "| mehr als 120 Stunden | 3 | 592,60 |",
    "| mehr als 160 Stunden | 4 | 888,50 |",
    "| mehr als 180 Stunden, wenn ein außergewöhnlicher Pflegeaufwand erforderlich ist | 5 | 1.206,90 |",
  ].join("\n"),
};
const law = {
  id: "bpgg-5",
  url: "sozdok://BPGG=PARA=5=80=2019-07-31=2020-01-01",
  text: [
    "§ 5 BPGG (SozDok, in Kraft seit 01.01.2020)",
    "Höhe des Pflegegeldes",
    "§ 5. (1) Das Pflegegeld gebührt zwölfmal jährlich und beträgt monatlich",
    "in Stufe 1 ............................................... 157,30 Euro",
    "  in Stufe 3 ............................................... 451,80 Euro,",
    "(2) An die Stelle dieser Beträge treten mit Wirkung vom 1. Jänner 2020 und in der Folge mit Wirkung vom 1. Jänner jeden Jahres die mit dem Anpassungsfaktor des § 108f ASVG vervielfachten und gemäß § 18 Abs. 4 auf volle 10 Cent gerundeten Beträge.",
  ].join("\n"),
};
const intro = {
  id: "pflegegeld-intro",
  url: table.url,
  text: "# Pflegegeld\n\nMit dem Pflegegeld wird ein Teil der pflegebedingten Mehraufwendungen durch eine pauschale Geldleistung abgegolten.",
};
const otherFee = {
  id: "rezeptgebuehr",
  url: "https://www.sozialversicherung.gv.at/cdscontent/?contentid=10007.870471&portal=oegkportal",
  text: "# Rezeptgebühr und Rezeptgebührenbefreiung\n\n## Wie hoch ist die Rezeptgebühr?\n\nDie Rezeptgebühr beträgt EUR 7,55 pro Packung (2026).",
};

test("an amount question ranks the current table first and drops the law's outdated base amounts", () => {
  // Lexical order of the live index: the consolidated law text outranked the table.
  const fused = [law, intro, otherFee, table];
  const ranked = rankForAmounts(fused, "Wie hoch ist das Pflegegeld in Stufe 3?", "2026-11-06");
  expect(ranked.map((passage) => passage.id)).toEqual([table.id, intro.id, otherFee.id]);
  // A fee of another benefit with a current amount is not promoted for this question.
  expect(rankForAmounts(fused, "Wie viel Familienbeihilfe bekomme ich?", "2026-11-06")).toEqual(
    fused,
  );
  // The Rezeptgebühr question still finds its current amount first.
  expect(rankForAmounts(fused, "Wie hoch ist die Rezeptgebühr 2026?", "2026-11-06")[0]?.id).toBe(
    otherFee.id,
  );
});

test("without a current figure, or for other questions, the fused order stays", () => {
  expect(rankForAmounts([law, intro], "Wie hoch ist das Pflegegeld?", "2026-11-06")).toEqual([
    law,
    intro,
  ]);
  expect(rankForAmounts([law, table], "Wo beantrage ich Pflegegeld?", "2026-11-06")).toEqual([
    law,
    table,
  ]);
  // Next year the 2026 table is no longer current; nothing is promoted or dropped.
  expect(rankForAmounts([law, table], "Wie hoch ist das Pflegegeld?", "2027-02-01")).toEqual([
    law,
    table,
  ]);
  expect(asksForAmount("Was kostet ein Rezept?")).toBe(true);
  expect(asksForAmount("Wo ist das nächste Amt?")).toBe(false);
});

test("currency amounts parse in German and English notation", () => {
  expect(moneyAmounts("Stufe 3: 592,60 Euro; Stufe 5: 1.206,90 €; EUR 7,55; €592.60")).toEqual([
    59260, 120690, 755, 59260,
  ]);
  // Years, levels and hours are not amounts.
  expect(moneyAmounts("Stufe 3 ab 2026 bei mehr als 120 Stunden")).toEqual([]);
  expect(amountsAppearIn("In Stufe 5 sind es 1206,90 Euro.", [table.text])).toBe(true);
});

test("the citation guard accepts a value from a cited table row and rejects an outdated figure", async () => {
  const supports = vi.fn(async () => true);
  const claim = (text: string) => ({
    text,
    citations: [{ passageId: table.id, url: table.url, quote: table.text }],
  });
  await expect(
    verifyCitation(
      claim(
        `Das Pflegegeld beträgt in Stufe 3 im Jahr 2026 monatlich 592,60 Euro [passage:${table.id}].`,
      ),
      [table],
      supports,
    ),
  ).resolves.toEqual({ valid: true, reason: "valid" });
  expect(supports).toHaveBeenCalledTimes(1);
  // The 2020 base amount of § 5 BPGG is not in the cited table: rejected without a model call.
  await expect(
    verifyCitation(
      claim(`Das Pflegegeld beträgt in Stufe 3 monatlich 451,80 Euro [passage:${table.id}].`),
      [table],
      supports,
    ),
  ).resolves.toEqual({ valid: false, reason: "unsupported" });
  expect(supports).toHaveBeenCalledTimes(1);

  const answer = `Das Pflegegeld beträgt in Stufe 3 im Jahr 2026 monatlich 592,60 Euro [passage:${table.id}]. Soll ich den Antrag öffnen?`;
  await expect(dropUnsupportedSentences(answer, [table], supports, "de-AT")).resolves.toEqual({
    text: answer,
    removed: 0,
  });
});
