import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { KNOWLEDGE_SYNONYMS_URL } from "../config/index.ts";

const schema = z.strictObject({ groups: z.array(z.array(z.string().min(1)).min(2)) });
let cached: Promise<string[][]> | undefined;
export function loadSynonyms(): Promise<string[][]> {
  cached ??= readFile(KNOWLEDGE_SYNONYMS_URL, "utf8").then(
    (text) => schema.parse(parse(text)).groups,
  );
  return cached;
}
export function expandQuery(query: string, groups: string[][]): string {
  const tokens = (value: string): string =>
    ` ${(value.toLocaleLowerCase("de-AT").match(/[\p{L}\p{N}]+/gu) ?? []).join(" ")} `;
  const normalized = tokens(query);
  const additions = groups
    .filter((group) =>
      group.some((term) => {
        return normalized.includes(tokens(term));
      }),
    )
    .flat();
  return [...new Set([query, ...additions])].join(" ");
}
export function fullTextQuery(query: string): string {
  // plainto_tsquery would AND all synonyms. OR preserves recall of either spelling.
  return [...new Set(query.match(/[\p{L}\p{N}]+/gu) ?? [])].map((term) => `'${term}'`).join(" | ");
}

export function synonymAlternatives(value: string, groups: string[][]): string[] {
  const lower = value.toLocaleLowerCase("de-AT");
  return [
    ...new Set([
      value,
      ...groups
        .filter((group) => group.some((term) => term.toLocaleLowerCase("de-AT") === lower))
        .flat(),
    ]),
  ].map((term) => term.toLocaleLowerCase("de-AT"));
}
