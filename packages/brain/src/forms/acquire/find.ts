import { readFile } from "node:fs/promises";
import type { DatabaseClient } from "@lotse/db";
import { benefits, formTemplates, sources } from "@lotse/db/schema";
import { desc, ilike, or } from "drizzle-orm";
import { parse } from "yaml";
import { z } from "zod";
import {
  FORM_SEARCH_LIMIT,
  FORM_SEARCH_PAGE_LIMIT,
  FORM_SEARCH_REQUEST_LIMIT,
} from "../../config/index.ts";
import { contracts } from "../../tools/contracts/index.ts";
import { formPolicy } from "../policy.ts";
import type { Template } from "../schema.ts";
import { fetchOfficial, officialOrigins, officialUrl } from "./http.ts";

type Candidate = z.infer<(typeof contracts)["form.find"]["output"]>[number];
type Search = z.infer<(typeof contracts)["form.find"]["input"]>;
type Page = { title: string; url: string; publisher: string };
const NeedRecord = z.object({
  carriers: z.array(z.string()).default([]),
  forms: z.array(z.union([z.string(), z.object({ search: z.string(), publisher: z.string() })])),
  sources: z.array(z.object({ url: z.string() })).default([]),
});
const discoveryPattern = new RegExp(formPolicy.discovery_pattern, "iu");

function officialLinks(html: string, base: string, origins: Set<string>): Page[] {
  const links: Page[] = [];
  for (const match of html.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu,
  )) {
    try {
      const url = officialUrl(
        new URL((match[1] ?? "").replaceAll("&amp;", "&"), base).href,
        origins,
      );
      const title = (match[2] ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      links.push({
        title: title || url.pathname.split("/").at(-1) || url.hostname,
        url: url.href,
        publisher: url.hostname,
      });
    } catch {
      /* Only exact allowlisted origins can enter the search queue. */
    }
  }
  return links;
}

/** Candidates are published links; a download's authoritative format is determined by acquire. */
export function officialPdfLinks(
  html: string,
  base: string,
  origins: Set<string>,
): { title: string; url: string }[] {
  return officialLinks(html, base, origins)
    .filter((link) => /\.pdf(?:$|\?)|\bpdf\b/iu.test(`${link.url} ${link.title}`))
    .map(({ title, url }) => ({ title, url }));
}

function contains(text: string, query: string): boolean {
  const normalized = text.toLocaleLowerCase("de");
  return query
    .toLocaleLowerCase("de")
    .split(/\s+/u)
    .some((word) => normalized.includes(word));
}

function registeredCandidates(
  templates: Template[],
  input: Search,
  formKeys: string[],
): Candidate[] {
  return templates
    .filter((template) => {
      const linked =
        formKeys.includes(`ref:forms/${template.schema.id}`) ||
        formKeys.includes(`ref:forms/${template.id}`);
      const text = `${template.title} ${template.publisher} ${template.source} ${template.schema.id ?? ""}`;
      return (
        (linked || contains(text, input.need)) &&
        (linked || !input.carrier || contains(text, input.carrier)) &&
        (!input.region || !template.schema.region || template.schema.region === input.region)
      );
    })
    .map((template) => ({
      title: template.title,
      publisher: template.publisher,
      url: /^https?:/.test(template.source)
        ? template.source
        : `svbox:${encodeURI(template.source.replace(/^svbox:/, ""))}`,
      format: template.format,
      versionDate: template.versionDate,
      templateId: template.id,
    }));
}

async function seedPages(input: Search): Promise<Page[]> {
  const raw = await readFile(
    new URL("../../../../knowledge/ingest-sources.yaml", import.meta.url),
    "utf8",
  );
  const seeds = z
    .array(
      z.object({
        url: z.string(),
        publisher: z.string(),
        carrier: z.string().nullable(),
        region: z.string(),
      }),
    )
    .parse(parse(raw));
  return seeds
    .filter(
      (seed) =>
        (!input.carrier ||
          contains(`${seed.url} ${seed.publisher} ${seed.carrier ?? ""}`, input.carrier)) &&
        (!input.region || seed.region === "AT" || contains(seed.region, input.region)),
    )
    .map((seed) => ({ ...seed, title: seed.publisher }))
    .slice(0, FORM_SEARCH_PAGE_LIMIT);
}

async function searchPages(
  pages: Page[],
  input: Search,
  origins: Set<string>,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const queue = [...pages];
  const visited = new Set<string>();
  const result: Candidate[] = [];
  while (queue.length && visited.size < FORM_SEARCH_REQUEST_LIMIT) {
    const page = queue.shift();
    if (!page || visited.has(page.url)) continue;
    visited.add(page.url);
    try {
      const downloaded = await fetchOfficial(page.url, origins, signal);
      if (Buffer.from(downloaded.bytes.subarray(0, 5)).toString("ascii") === "%PDF-") {
        result.push({
          title: page.title,
          publisher: page.publisher,
          url: downloaded.url,
          format: "flat",
          versionDate: null,
        });
        continue;
      }
      const html = Buffer.from(downloaded.bytes).toString("utf8");
      for (const link of officialPdfLinks(html, downloaded.url, origins)) {
        if (contains(`${link.title} ${page.title}`, input.need))
          result.push({ ...link, publisher: page.publisher, format: "flat", versionDate: null });
      }
      queue.unshift(
        ...officialLinks(html, downloaded.url, origins)
          .filter((link) => contains(link.title, input.need) || discoveryPattern.test(link.title))
          .slice(0, FORM_SEARCH_PAGE_LIMIT),
      );
    } catch {
      signal?.throwIfAborted();
    }
  }
  return result;
}

function distinctCandidates(candidates: Candidate[]): Candidate[] {
  const distinct = new Map<string, Candidate>();
  for (const candidate of candidates)
    if (!distinct.has(candidate.url)) distinct.set(candidate.url, candidate);
  return [...distinct.values()].slice(0, FORM_SEARCH_LIMIT);
}

export async function findForms(
  db: DatabaseClient,
  raw: unknown,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const input = contracts["form.find"].input.parse(raw);
  const pattern = `%${input.need.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const templates = await db
    .select()
    .from(formTemplates)
    .orderBy(desc(formTemplates.versionDate), desc(formTemplates.retrievedAt));
  const matchingBenefits = await db
    .select()
    .from(benefits)
    .where(or(ilike(benefits.key, pattern), ilike(benefits.title, pattern)));
  const needs = matchingBenefits
    .map((benefit) => NeedRecord.parse(benefit.record))
    .filter((record) => !input.carrier || record.carriers.includes(input.carrier));
  const formKeys = needs.flatMap((record) =>
    record.forms.filter((item) => typeof item === "string"),
  );
  const registered = registeredCandidates(templates, input, formKeys);
  if (registered.length) return distinctCandidates(registered);
  const indexed = await db
    .select()
    .from(sources)
    .where(or(ilike(sources.title, pattern), ilike(sources.text, pattern)))
    .limit(FORM_SEARCH_PAGE_LIMIT);
  const cited = needs.flatMap((record) =>
    record.sources.map((source) => ({
      ...source,
      title: input.need,
      publisher: new URL(source.url).hostname,
    })),
  );
  const hints = needs.flatMap((record) => record.forms.filter((form) => typeof form !== "string"));
  const query = hints[0]?.search ?? input.need;
  const pages = [...cited, ...indexed, ...(await seedPages({ ...input, need: query }))].slice(
    0,
    FORM_SEARCH_PAGE_LIMIT,
  );
  return distinctCandidates(
    await searchPages(pages, { ...input, need: query }, await officialOrigins(), signal),
  );
}
