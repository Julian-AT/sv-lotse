export interface QuoteRange {
  index: number;
  start: number;
  end: number;
}

function normalized(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Only whitespace is normalized. Never pick a similar sentence or an ambiguous occurrence. */
export function findQuoteRanges(parts: readonly string[], quote: string): QuoteRange[] {
  let joined = "";
  const positions: { index: number; offset: number }[] = [];
  parts.forEach((part, index) => {
    if (joined && !joined.endsWith(" ")) {
      joined += " ";
      positions.push({ index: -1, offset: 0 });
    }
    for (let offset = 0; offset < part.length; offset++) {
      const char = part[offset] ?? "";
      if (/\s/u.test(char)) {
        if (joined.endsWith(" ") || !joined) continue;
        joined += " ";
      } else joined += char;
      positions.push({ index, offset });
    }
  });
  const needle = normalized(quote);
  if (!needle) return [];
  const start = joined.indexOf(needle);
  if (start < 0 || joined.indexOf(needle, start + 1) >= 0) return [];
  const ranges: QuoteRange[] = [];
  for (const position of positions.slice(start, start + needle.length)) {
    if (position.index < 0) continue;
    const previous = ranges.at(-1);
    if (previous?.index === position.index) previous.end = position.offset + 1;
    else ranges.push({ index: position.index, start: position.offset, end: position.offset + 1 });
  }
  return ranges.filter((range) => range.end > range.start);
}
