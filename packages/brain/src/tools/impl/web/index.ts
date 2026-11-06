import { openai } from "@ai-sdk/openai";
import { loadPortalPolicy } from "@lotse/knowledge/portal-policy";
import { generateText, type LanguageModel } from "ai";
import type { z } from "zod";
import { BOOKING_ALLOWLIST_FILE, parseBrainConfig } from "../../../config/index.ts";
import { createModelRouter } from "../../../models/index.ts";
import { contracts } from "../../contracts/index.ts";
import type { Implementations, ToolDependencies } from "../../types.ts";
import { portalPageAllowed } from "../ui/resource.ts";

type PageQuery = z.infer<(typeof contracts)["web.findOfficialPage"]["input"]>;
export type OfficialPage = { url: string; title: string; snippet: string };

const SEARCH_TIMEOUT_MS = 6_000;
const MAX_PAGES = 3;
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

function parseLines(text: string): OfficialPage[] {
  return text.split("\n").flatMap((line) => {
    const [link = "", title = "", ...rest] = line.split("|").map((part) => part.trim());
    const url = link.match(/https:\/\/[^\s<>()[\]]+/u)?.[0]?.replace(/[.,;]+$/u, "");
    return url ? [{ url, title, snippet: rest.join(" | ") }] : [];
  });
}

/**
 * One web search restricted to the allowlisted portals. Only pages the search actually returned
 * on an allowlisted origin survive; a failed or slow search yields an empty list.
 */
export async function findOfficialPages(
  query: PageQuery,
  options: {
    model: LanguageModel;
    origins: readonly string[];
    signal?: AbortSignal | undefined;
  },
): Promise<OfficialPage[]> {
  const preferred = preferredHost(query);
  try {
    const result = await generateText({
      model: options.model,
      instructions: INSTRUCTIONS,
      prompt: JSON.stringify({
        ...query,
        ...(preferred ? { preferredSite: preferred } : {}),
      }),
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
    const cited = parseLines(result.text).filter((page) => seen.has(pageKey(page.url)));
    const candidates = cited.length
      ? cited
      : found.map((url) => ({
          url,
          title: new URL(url).hostname,
          snippet: "",
        }));
    const unique = new Map<string, OfficialPage>();
    for (const page of candidates) {
      const key = pageKey(page.url);
      if (!key || unique.has(key) || !portalPageAllowed(page.url, options.origins)) continue;
      unique.set(key, {
        ...page,
        url: key,
        title: page.title || new URL(page.url).hostname,
      });
    }
    return [...unique.values()]
      .sort(
        (left, right) =>
          Number(new URL(right.url).host === preferred) -
          Number(new URL(left.url).host === preferred),
      )
      .slice(0, MAX_PAGES);
  } catch {
    options.signal?.throwIfAborted();
    return [];
  }
}

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "web.findOfficialPage": async (raw, _context, options) =>
      findOfficialPages(contracts["web.findOfficialPage"].input.parse(raw), {
        model: createModelRouter(deps.config ?? parseBrainConfig()).modelFor("extractor"),
        origins: await allowlistedOrigins(),
        signal: options.abortSignal,
      }),
  };
}
