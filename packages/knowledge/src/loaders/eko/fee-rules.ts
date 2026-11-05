// Administrative information verified on 2026-11-05; never infer personal eligibility.
export const feeRules = Object.freeze({
  prescriptionFee: Object.freeze({
    amountCents: 755,
    currency: "EUR",
    year: 2026,
    asOf: "2026-11-05",
  }),
  capRule: Object.freeze({
    incomePercent: 2,
    minimumAnnualCents: 31401,
    year: 2026,
    asOf: "2026-11-05",
    text: "2026: Zwei Prozent des Jahresnettoeinkommens ohne Sonderzahlungen; die Mindestobergrenze beträgt 314,01 Euro. Danach erfolgt die Befreiung automatisch für den Rest des Kalenderjahres.",
  }),
  exemptionRule:
    "Bestimmte Personengruppen sind automatisch befreit. Bei geringem Einkommen ist ein Antrag beim Krankenversicherungsträger möglich; persönliche Voraussetzungen und Einkommensgrenzen sind dort zu prüfen.",
  sources: Object.freeze([
    Object.freeze({
      url: "https://www.sozialversicherung.gv.at/cdscontent/?contentid=10007.870471",
      asOf: "2026-11-05",
      quote: "Die Rezeptgebühr beträgt EUR 7,55 pro Packung (2026).",
      minimumQuote: "pro Kalenderjahr zumindest EUR 314,01 bezahlen",
    }),
    Object.freeze({
      url: "https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2025_I_20/BGBLA_2025_I_20.html",
      asOf: "2026-11-05",
      quote: "im Jahr 2026 mit 2%",
    }),
  ]),
});
