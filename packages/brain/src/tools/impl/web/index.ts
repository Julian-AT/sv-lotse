import { openai } from "@ai-sdk/openai";
import { readPageStructure } from "@lotse/knowledge/page-reader";
import { loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import type { Target } from "@lotse/protocol";
import { generateText, type LanguageModel } from "ai";
import type { z } from "zod";
import { BOOKING_ALLOWLIST_FILE, parseBrainConfig } from "../../../config/index.ts";
import { untrustedSourceText } from "../../../guards/source.ts";
import { createModelRouter } from "../../../models/index.ts";
import { searchKnowledge } from "../../../retrieval/index.ts";
import { contracts } from "../../contracts/index.ts";
import type { Implementations, ToolDependencies } from "../../types.ts";
import { isGuidanceRequest, pageOffer, portalPageAllowed } from "../ui/resource.ts";

type PageQuery = z.infer<(typeof contracts)["web.findOfficialPage"]["input"]>;
export type OfficialPage = { url: string; title: string; snippet: string };
type PageRead = z.infer<(typeof contracts)["web.readPage"]["output"]>;

const SEARCH_TIMEOUT_MS = 4_000;
const MAX_PAGES = 3;
const READ_TIMEOUT_MS = 5_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
export const MAX_PAGE_READS = 2;
const APPLY = /antrag|beantrag|formular/iu;
const STOPWORDS = new Set(["antragsformular", "offizielle", "seite", "online"]);
const CARRIER_HOSTS: Record<string, string> = {
  pva: "www.pv.at",
  pv: "www.pv.at",
  pensionsversicherung: "www.pv.at",
  ögk: "www.oegk.at",
  oegk: "www.oegk.at",
  gesundheitskasse: "www.oegk.at",
  svs: "www.svs.at",
  bvaeb: "www.bvaeb.at",
  sms: "www.sozialministeriumservice.gv.at",
  sozialministeriumservice: "www.sozialministeriumservice.gv.at",
  fsw: "www.fsw.at",
  bmf: "www.bmf.gv.at",
  finanzamt: "www.bmf.gv.at",
};
const INSTRUCTIONS = `Find the official web page that best serves the person's request in Austria's health and social insurance administration. Search the allowed official sites, preferring the responsible carrier's site when one is named.
Reply with at most ${MAX_PAGES} lines, best first, each exactly: URL | page title | one short German sentence on what the page offers. Use only URLs from your search results. No other text.`;

let origins: Promise<readonly string[]> | undefined;
function allowlistedOrigins(): Promise<readonly string[]> {
  origins ??= loadPortalPolicy(BOOKING_ALLOWLIST_FILE).then((policy) =>
    policy.origins.map((entry) => entry.origin),
  );
  return origins;
}

/** Same page regardless of fragment, trailing slash or tracking parameters the search adds. */
function pageKey(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    for (const name of [...url.searchParams.keys()])
      if (name.startsWith("utm_")) url.searchParams.delete(name);
    url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/$/u, "")}${url.search}`;
  } catch {
    return undefined;
  }
}

function preferredHost(query: PageQuery): string | undefined {
  const words = `${query.carrier ?? ""} ${query.query}`.toLowerCase().split(/[^\p{L}]+/u);
  return words.map((word) => CARRIER_HOSTS[word]).find(Boolean);
}

function isHomePage(raw: string): boolean {
  const url = new URL(raw);
  return url.pathname.replace(/\/$/u, "") === "" && !url.search;
}

/** Deeper, more on-topic pages on the responsible carrier's site rank first. */
function pageScore(page: OfficialPage, query: PageQuery, preferred: string | undefined): number {
  const url = new URL(page.url);
  const depth = url.pathname.split("/").filter(Boolean).length + (url.search ? 1 : 0);
  const haystack = `${url.pathname}${url.search} ${page.title}`.toLowerCase();
  const words = queryWords(query.query);
  const matches = words.filter((word) => haystack.includes(word)).length;
  return (
    Math.min(depth, 4) +
    matches * 2 +
    (APPLY.test(haystack) ? 2 : 0) +
    (url.host === preferred ? 3 : 0)
  );
}

function queryWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 5 && !STOPWORDS.has(word));
}

function parseLines(text: string): OfficialPage[] {
  return text.split("\n").flatMap((line) => {
    const [link = "", title = "", ...rest] = line.split("|").map((part) => part.trim());
    const url = link.match(/https:\/\/[^\s<>()[\]]+/u)?.[0]?.replace(/[.,;]+$/u, "");
    return url ? [{ url, title, snippet: rest.join(" | ") }] : [];
  });
}

type Candidate = { page: OfficialPage; cited: boolean };

async function searchWeb(
  query: PageQuery,
  preferred: string | undefined,
  options: { model: LanguageModel; origins: readonly string[]; signal?: AbortSignal | undefined },
): Promise<Candidate[]> {
  try {
    const result = await generateText({
      model: options.model,
      instructions: INSTRUCTIONS,
      prompt: JSON.stringify({ ...query, ...(preferred ? { preferredSite: preferred } : {}) }),
      tools: {
        web_search: openai.tools.webSearch({
          filters: {
            allowedDomains: options.origins.map((origin) => new URL(origin).hostname),
          },
          searchContextSize: "low",
          userLocation: { type: "approximate", country: "AT" },
        }),
      },
      toolChoice: { type: "tool", toolName: "web_search" },
      maxOutputTokens: 400,
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        ...(options.signal ? [options.signal] : []),
      ]),
      telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false },
    });
    const found = result.sources.flatMap((source) =>
      source.sourceType === "url" ? [source.url] : [],
    );
    const seen = new Set(found.map(pageKey));
    return [
      ...parseLines(result.text)
        .filter((page) => seen.has(pageKey(page.url)))
        .map((page) => ({ page, cited: true })),
      ...found.map((url) => ({ page: { url, title: "", snippet: "" }, cited: false })),
    ];
  } catch {
    options.signal?.throwIfAborted();
    return [];
  }
}

/**
 * Pages already known from the ingested official sources (`known`) and one web search restricted
 * to the allowlisted portals, run in parallel. Only real pages on an allowlisted origin survive,
 * deepest and most on-topic first; a failed or slow search leaves the known pages.
 */
export async function findOfficialPages(
  query: PageQuery,
  options: {
    model: LanguageModel;
    origins: readonly string[];
    known?: Promise<readonly OfficialPage[]>;
    signal?: AbortSignal | undefined;
  },
): Promise<OfficialPage[]> {
  const preferred = preferredHost(query);
  const [known, searched] = await Promise.all([
    (options.known ?? Promise.resolve([])).catch(() => []),
    searchWeb(query, preferred, options),
  ]);
  const unique = new Map<string, { page: OfficialPage; score: number }>();
  for (const { page, cited } of [...known.map((page) => ({ page, cited: true })), ...searched]) {
    const key = pageKey(page.url);
    if (!key || unique.has(key) || !portalPageAllowed(page.url, options.origins)) continue;
    const kept = { ...page, url: key, title: page.title || new URL(key).hostname };
    unique.set(key, { page: kept, score: pageScore(kept, query, preferred) + (cited ? 2 : 0) });
  }
  const ranked = [...unique.values()].sort((left, right) => right.score - left.score);
  const deep = ranked.filter(({ page }) => !isHomePage(page.url));
  return (deep.length ? deep : ranked).slice(0, MAX_PAGES).map(({ page }) => page);
}

/** Retrieval passages of ingested official pages that match the request. */
async function knownPages(
  deps: ToolDependencies,
  query: PageQuery,
  signal: AbortSignal | undefined,
): Promise<OfficialPage[]> {
  if (!deps.db) return [];
  const passages = await searchKnowledge(
    deps.db,
    deps.config ?? parseBrainConfig(),
    { query: query.query, filters: {}, k: 8 },
    signal,
  );
  return passages.map((passage) => ({ url: passage.url, title: "", snippet: passage.text }));
}

/** The page itself is the evidence for "you apply here", so the answer may state it. */
function withSource<T extends { url: string }>(page: T, quote: string) {
  const text = quote.replace(/\s+/gu, " ").trim().slice(0, 300);
  return {
    ...page,
    sources: text
      ? [{ url: page.url, quote: text, asOf: new Date().toISOString().slice(0, 10) }]
      : [],
  };
}

async function readCapped(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_PAGE_BYTES)
    throw new Error("PAGE_TOO_LARGE");
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let chunk = await reader?.read(); chunk && !chunk.done; chunk = await reader?.read()) {
    length += chunk.value.byteLength;
    if (length > MAX_PAGE_BYTES) {
      await reader?.cancel();
      throw new Error("PAGE_TOO_LARGE");
    }
    chunks.push(chunk.value);
  }
  const charset =
    /charset\s*=\s*["']?([^;\s"']+)/iu.exec(response.headers.get("content-type") ?? "")?.[1] ??
    "utf-8";
  return new TextDecoder(charset).decode(Buffer.concat(chunks));
}

function pdfRead(url: string): PageRead {
  return {
    url,
    kind: "pdf",
    title: "",
    headings: [],
    text: "",
    links: [],
    fields: [],
    formPdf: url,
    sources: [],
  };
}

/**
 * Fetches one allowlisted page on the user's behalf (every redirect hop is re-checked against the
 * allowlist) and returns its compact structure. Page text is untrusted data, never instructions.
 */
export async function readOfficialPage(
  raw: string,
  options: {
    origins: readonly string[];
    fetcher?: typeof fetch;
    signal?: AbortSignal | undefined;
  },
): Promise<PageRead> {
  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.any([
    AbortSignal.timeout(READ_TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]);
  let url = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!portalPageAllowed(url, options.origins)) throw new Error("PAGE_NOT_ALLOWED");
    if (/\.pdf$/iu.test(new URL(url).pathname)) return pdfRead(url);
    const response = await fetcher(url, {
      redirect: "manual",
      signal,
      headers: { Accept: "text/html, application/xhtml+xml", "User-Agent": "SV-KI-Lotse/1.0" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new Error("PAGE_UNAVAILABLE");
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type === "application/pdf") {
      await response.body?.cancel();
      return pdfRead(url);
    }
    if (type !== "text/html" && type !== "application/xhtml+xml") throw new Error("PAGE_NOT_HTML");
    const page = readPageStructure(await readCapped(response), url, (href) =>
      portalPageAllowed(href, options.origins),
    );
    const formPdf = page.links.find((link) => link.pdf && (link.form || link.apply))?.href;
    const text = untrustedSourceText(page.text);
    return withSource(
      {
        url,
        kind: "html" as const,
        title: untrustedSourceText(page.title),
        headings: page.headings.map(untrustedSourceText),
        text,
        links: page.links.map((link) => ({ ...link, text: untrustedSourceText(link.text) })),
        fields: page.fields.map((field) => ({ ...field, label: untrustedSourceText(field.label) })),
        ...(formPdf ? { formPdf } : {}),
      },
      text || untrustedSourceText(page.title),
    );
  }
  throw new Error("PAGE_REDIRECT_LIMIT");
}

/** The on-topic apply or form link of a read page; generic "Formulare" menus do not count. */
function applyLink(page: PageRead, query: string): PageRead["links"][number] | undefined {
  const words = queryWords(query);
  return page.links
    .filter((link) => link.apply || link.form)
    .map((link) => ({
      link,
      matches: words.filter((word) => `${link.text} ${link.href}`.toLowerCase().includes(word))
        .length,
    }))
    .filter(({ matches }) => matches > 0)
    .sort(
      (left, right) =>
        right.matches - left.matches ||
        Number(right.link.apply) - Number(left.link.apply) ||
        Number(left.link.pdf) - Number(right.link.pdf),
    )[0]?.link;
}

/**
 * Server-side offer for a where-to-apply request: the deepest official page among the turn's
 * sources and a web search, followed one link further to its on-topic apply page when it has one.
 */
export async function deepPageOffer(input: {
  userTexts: readonly string[];
  sources: readonly { url: string }[];
  model: LanguageModel;
  signal?: AbortSignal | undefined;
}): Promise<{ target: Target; label: string } | undefined> {
  if (!isGuidanceRequest(input.userTexts)) return;
  const query = input.userTexts.slice(0, 2).join(" ").slice(0, 300);
  const origins = await allowlistedOrigins();
  const [best] = await findOfficialPages(
    { query },
    {
      model: input.model,
      origins,
      known: Promise.resolve(input.sources.map(({ url }) => ({ url, title: "", snippet: "" }))),
      signal: input.signal,
    },
  );
  if (!best) return pageOffer(input.sources);
  const page = await readOfficialPage(best.url, { origins, signal: input.signal }).catch(
    () => undefined,
  );
  const link = page && applyLink(page, query);
  const url = link?.href ?? page?.url ?? best.url;
  const name = (link?.text ?? page?.title ?? "").slice(0, 80);
  const host = new URL(url).hostname.replace(/^www\./u, "");
  return {
    target: { kind: "dom", handle: "page", url },
    label: name ? `die Seite „${name}“ auf ${host}` : `die offizielle Seite auf ${host}`,
  };
}

export function implementations(deps: ToolDependencies): Implementations {
  let reads = 0;
  return {
    "web.readPage": async (raw, _context, options) => {
      if (++reads > MAX_PAGE_READS) throw new Error("PAGE_READ_LIMIT");
      return readOfficialPage(contracts["web.readPage"].input.parse(raw).url, {
        origins: await allowlistedOrigins(),
        signal: options.abortSignal,
      });
    },
    "web.findOfficialPage": async (raw, _context, options) => {
      const query = contracts["web.findOfficialPage"].input.parse(raw);
      const pages = await findOfficialPages(query, {
        model: createModelRouter(deps.config ?? parseBrainConfig()).modelFor("extractor"),
        origins: await allowlistedOrigins(),
        known: knownPages(deps, query, options.abortSignal),
        signal: options.abortSignal,
      });
      return pages.map((page) => withSource(page, page.snippet || page.title));
    },
  };
}
