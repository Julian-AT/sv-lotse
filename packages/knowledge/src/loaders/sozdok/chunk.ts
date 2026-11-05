import { z } from "zod";
import type { SozdokVersion } from "./versions.ts";

export function sozdokCitation(
  record: Pick<SozdokVersion, "gldart" | "paragraph" | "law_abbr" | "in_force_from">,
): string {
  const [year, month, day] = record.in_force_from.split("-");
  const symbol = record.gldart === "PARA" ? "§" : record.gldart === "ART" ? "Art." : record.gldart;
  return `${symbol} ${record.paragraph.gldnr} ${record.law_abbr} (SozDok, in Kraft seit ${day}.${month}.${year})`;
}

export function sozdokMetadata(record: SozdokVersion) {
  return {
    kind: "legal" as const,
    law_abbr: record.law_abbr,
    paragraph: record.paragraph,
    gldart: record.gldart,
    in_force_from: record.in_force_from,
    in_force_to: record.in_force_to,
    dokid: record.dokid,
    file: record.file,
  };
}
export interface SozdokChunk {
  url: string;
  text: string;
  citation: string;
  index: number;
  metadata: ReturnType<typeof sozdokMetadata>;
}

/** Approximate token budget at four Unicode characters per token; absatz stay indivisible. */
export function chunkSozdok(record: SozdokVersion, maxTokens = 1500): SozdokChunk[] {
  z.number().int().positive().parse(maxTokens);
  const texts: string[] = [];
  let current = "";
  const rowEnds = new Map<number, number>();
  for (const { start, end } of record.table_rows ?? []) {
    rowEnds.set(start, Math.max(end, rowEnds.get(start) ?? 0));
  }
  for (let index = 0; index < record.absatz.length; index++) {
    let absatz = record.absatz[index] ?? "";
    const rowEnd = rowEnds.get(index);
    if (rowEnd !== undefined) {
      const row = record.absatz.slice(index, rowEnd).join("\n\n");
      // Prefer a complete row for context, but never let it bypass the budget.
      if (Array.from(row).length <= maxTokens * 4) {
        absatz = row;
        index = rowEnd - 1;
      }
    }
    const combined = current ? `${current}\n\n${absatz}` : absatz;
    if (current && Array.from(combined).length > maxTokens * 4) {
      texts.push(current);
      current = absatz;
    } else current = combined;
  }
  if (current) texts.push(current);
  return texts.map((text, index) => ({
    url: `sozdok://${record.dokid}`,
    text,
    index,
    citation: sozdokCitation(record),
    metadata: sozdokMetadata(record),
  }));
}
