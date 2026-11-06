/**
 * Amount questions ("Wie hoch ist das Pflegegeld in Stufe 3?") need a source that states the
 * amount for the current period. Consolidated law text often keeps the base amounts of its
 * enactment and has them replaced every year by an adjustment factor, so its figures are outdated
 * although the paragraph itself is in force; official pages and their tables name the year.
 */
const AMOUNT_QUESTION =
  /wie\s*(?:hoch|viel)|h(?:ö|oe)he|betr(?:a|ä)g|kostet|geb(?:ü|ue)hr|\beuro\b|€|how\s+much|\bamount|\bcosts?\b/iu;
/** The law replaces the stated amounts each year (Anpassungsfaktor, valorisiert, vervielfacht). */
const YEARLY_ADJUSTMENT = /anpassungsfaktor|valorisier|vervielfach/iu;
/** Words that ask for an amount but say nothing about which benefit is meant. */
const AMOUNT_WORDS = new Set([
  "hoch",
  "höhe",
  "viel",
  "wieviel",
  "betrag",
  "beträgt",
  "beträge",
  "kostet",
  "kosten",
  "euro",
  "monatlich",
  "jährlich",
  "aktuell",
  "aktuelle",
  "aktuellen",
  "derzeit",
  "much",
  "amount",
  "cost",
  "costs",
]);

export function asksForAmount(query: string): boolean {
  return AMOUNT_QUESTION.test(query);
}

/** Every number in the text as cents: "1.206,90", "1206,90", "592.60" and "7" all parse. */
export function numberValues(text: string): number[] {
  return [...text.matchAll(/\d(?:[\d.,]*\d)?/gu)].flatMap((match) => {
    const value = parseNumber(match[0]);
    return value === undefined ? [] : [value];
  });
}

function parseNumber(token: string): number | undefined {
  const separator = Math.max(token.lastIndexOf(","), token.lastIndexOf("."));
  const decimals = separator >= 0 ? token.slice(separator + 1) : "";
  // One or two digits after the last separator are cents; three are a thousands group.
  const hasCents = decimals.length === 1 || decimals.length === 2;
  const whole = (hasCents ? token.slice(0, separator) : token).replace(/[.,]/gu, "");
  const cents = Number(whole) * 100 + (hasCents ? Number(decimals.padEnd(2, "0")) : 0);
  return Number.isSafeInteger(cents) ? cents : undefined;
}

/** Amounts written with a currency ("592,60 Euro", "EUR 7,55", "€ 1.206,90"), as cents. */
export function moneyAmounts(text: string): number[] {
  return [...text.matchAll(/\d(?:[\d.,]*\d)?/gu)].flatMap((match) => {
    const start = match.index;
    const end = start + match[0].length;
    const before = /(?:€|\bEUR|\bEuro)\s?$/iu.test(text.slice(Math.max(0, start - 6), start));
    const after = /^\s?(?:€|EUR\b|Euro\b)/iu.test(text.slice(end, end + 6));
    if (!before && !after) return [];
    const value = parseNumber(match[0]);
    return value === undefined ? [] : [value];
  });
}

/** True when every currency amount of the claim appears as a number in the cited text. */
export function amountsAppearIn(claim: string, cited: readonly string[]): boolean {
  const amounts = moneyAmounts(claim);
  if (amounts.length === 0) return true;
  const available = new Set(cited.flatMap(numberValues));
  return amounts.every((amount) => available.has(amount));
}

const hasAmount = (text: string): boolean =>
  /\d,\d{2}(?!\d)/u.test(text) || moneyAmounts(text).length > 0;
/** The words naming what the question is about; a year or a level number names no benefit. */
const terms = (text: string): string[] => [
  ...new Set(
    (text.toLocaleLowerCase("de-AT").match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(
      (term) => /\p{L}/u.test(term) && !AMOUNT_WORDS.has(term),
    ),
  ),
];

/**
 * Orders retrieved passages for an amount question: passages about the asked benefit that state
 * amounts for the current year come first. Passages whose amounts the law replaces every year
 * and that do not name the current year are dropped when a current amount is available, so an
 * outdated base amount is never offered as the answer. Other questions keep the fused order.
 */
export function rankForAmounts<T extends { text: string }>(
  passages: readonly T[],
  query: string,
  asOf: string,
): T[] {
  if (!asksForAmount(query)) return [...passages];
  const year = new RegExp(`(?<!\\d)${asOf.slice(0, 4)}(?!\\d)`, "u");
  const topic = terms(query);
  const about = (text: string): boolean => {
    if (topic.length === 0) return false;
    const lower = text.toLocaleLowerCase("de-AT");
    const matched = topic.filter((term) => lower.includes(term)).length;
    return matched > 0 && matched * 2 >= topic.length;
  };
  const current = passages.filter(
    (passage) => hasAmount(passage.text) && year.test(passage.text) && about(passage.text),
  );
  if (current.length === 0) return [...passages];
  const outdated = (text: string): boolean =>
    hasAmount(text) && YEARLY_ADJUSTMENT.test(text) && !year.test(text);
  return [
    ...current,
    ...passages.filter((passage) => !current.includes(passage) && !outdated(passage.text)),
  ];
}
