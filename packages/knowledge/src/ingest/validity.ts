import type { CheerioAPI } from "cheerio";
import { z } from "zod";

export interface Validity {
  valid_from: string | null;
  valid_to: string | null;
}

export function explicitDate(value: string | undefined): string | null {
  if (!value) return null;
  const german = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  const date = german ? `${german[3]}-${german[2]}-${german[1]}` : value;
  if (z.iso.date().safeParse(date).success) return `${date}T00:00:00.000Z`;
  if (z.iso.datetime({ offset: true }).safeParse(date).success) return new Date(date).toISOString();
  return null;
}

export function labelValidity(text: string): Validity {
  return {
    valid_from: explicitDate(
      /^Gültig (?:ab|von):?\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\s*$/im.exec(text)?.[1],
    ),
    valid_to: explicitDate(
      /^Gültig bis:?\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\s*$/im.exec(text)?.[1],
    ),
  };
}

export function preambleValidity($: CheerioAPI, nodes: ReturnType<CheerioAPI>): Validity {
  const labels: string[] = [];
  const visit = (children: ReturnType<CheerioAPI>): boolean => {
    for (const element of children.toArray()) {
      const child = $(element);
      if (child.is("section, article, h2, h3, h4, h5, h6")) return false;
      if (child.is("p, time")) labels.push(child.text().trim());
      else if (child.is("div, header, main, span") && !visit(child.children())) return false;
    }
    return true;
  };
  visit(nodes);
  return labelValidity(labels.join("\n"));
}

// Local validity may narrow its parent, but cannot extend a page's legal dates.
export function intersectValidity(parent: Validity, local: Validity): Validity {
  const starts = [parent.valid_from, local.valid_from].filter((date) => date !== null).sort();
  const ends = [parent.valid_to, local.valid_to].filter((date) => date !== null).sort();
  return { valid_from: starts.at(-1) ?? null, valid_to: ends[0] ?? null };
}
