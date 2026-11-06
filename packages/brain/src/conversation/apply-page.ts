import type { DatabaseClient } from "@lotse/db";
import { benefits } from "@lotse/db/schema";
import type { LanguageModel } from "ai";
import { openResourceAllowed } from "../tools/impl/ui/resource.ts";
import { type ApplyPage, findApplyPage } from "../tools/impl/web/index.ts";

/** A catalog benefit resolved from the conversation, with its responsible carrier. */
export type CatalogBenefit = {
  id: string;
  name: string;
  /** Carrier word the page search understands (pva, oegk, sms, bmf, ...). */
  carrier?: string;
  /** Official catalog source pages, used as known candidates for the page search. */
  sources: string[];
};

type CatalogRecord = {
  id: string;
  name_de: string;
  carriers?: string[];
  office_rules?: { office: string }[];
  sources?: { url: string }[];
};

/** Words people use for a benefit beyond its catalog name (folded, compact). */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  "oegk-wahlarzt-kostenerstattung": ["wahlarzt", "wahlaerzt"],
  "heilbehelfe-hilfsmittel": ["heilbehelf", "hilfsmittel"],
  "oegk-transportkosten": ["fahrtkosten", "krankentransport", "transportkosten"],
  "medical-rehabilitation": ["reha", "kur", "rehabilitation", "kuraufenthalt"],
  "pflege-24-stunden-betreuung": ["24stundenbetreuung", "24hbetreuung", "24stunden"],
  rezeptgebuehrenbefreiung: ["rezeptgebuehr"],
  "oegk-selbstversicherung": ["selbstversicher"],
};

/** Short names for the spoken sentence where the catalog name is long. */
const SHORT_NAMES: Readonly<Record<string, string>> = {
  "medical-rehabilitation": "Reha und Kur",
  "oegk-transportkosten": "Fahrtkosten",
  "oegk-wahlarzt-kostenerstattung": "Wahlarzt-Kostenerstattung",
  "pflege-24-stunden-betreuung": "24-Stunden-Betreuung",
  pflegekarenzgeld: "Pflegekarenzgeld",
  "oegk-selbstversicherung": "Selbstversicherung",
  "eko-medikamente-kostenuebernahme": "Medikamenten-Kostenübernahme",
  "bewilligung-chef-kontrollaerztlicher-dienst": "Chefarzt-Bewilligung",
};

/** Office prefixes of the catalog office rules mapped to the carrier word of the page search. */
const OFFICE_CARRIERS: Readonly<Record<string, string>> = {
  pva: "pva",
  oegk: "oegk",
  svs: "svs",
  bvaeb: "bvaeb",
  auva: "auva",
  sms: "sms",
  finanzamt: "bmf",
  fsw: "fsw",
};

/** Benefits without an application of their own (programme access, counselling). */
const NOT_APPLIED_FOR = /^praevention-|^familie-(?:kinderimpfprogramm|familienberatung)$/u;

const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .replace(/ß/gu, "ss");
const compact = (text: string) => fold(text).replace(/[^a-z0-9]+/gu, "");

function keywordsOf(record: CatalogRecord): string[] {
  const core = record.id.replace(/^(?:oegk|familie|pflege)-/u, "");
  return [compact(record.name_de), compact(core), ...(ALIASES[record.id] ?? [])];
}

function carrierOf(record: CatalogRecord): string | undefined {
  const office = record.office_rules?.[0]?.office.match(/offices\/([a-z]+)/u)?.[1];
  return (office && OFFICE_CARRIERS[office]) ?? record.carriers?.[0];
}

/** The catalog benefit the newest text names; the longest keyword wins within one text. */
export function matchBenefit(
  records: readonly CatalogRecord[],
  texts: readonly string[],
): CatalogBenefit | undefined {
  for (const text of texts) {
    const spaced = ` ${fold(text).replace(/[^a-z0-9]+/gu, " ")} `;
    const dense = compact(text);
    let best: CatalogRecord | undefined;
    let length = 0;
    for (const record of records) {
      if (NOT_APPLIED_FOR.test(record.id)) continue;
      for (const keyword of keywordsOf(record)) {
        const hit = keyword.length >= 6 ? dense.includes(keyword) : spaced.includes(` ${keyword} `);
        if (hit && keyword.length > length) {
          best = record;
          length = keyword.length;
        }
      }
    }
    if (best) {
      const carrier = carrierOf(best);
      return {
        id: best.id,
        name: SHORT_NAMES[best.id] ?? best.name_de,
        ...(carrier ? { carrier } : {}),
        sources: [...new Set((best.sources ?? []).map((source) => source.url.split("#")[0] ?? ""))]
          .filter(Boolean)
          .slice(0, 4),
      };
    }
  }
  return undefined;
}

let catalog: Promise<CatalogRecord[]> | undefined;

/** The catalog benefit for the conversation's newest topic text (catalog loaded once). */
export async function catalogBenefit(
  db: DatabaseClient,
  texts: readonly string[],
): Promise<CatalogBenefit | undefined> {
  catalog ??= db
    .select({ record: benefits.record })
    .from(benefits)
    .then((rows) => rows.map((row) => row.record as CatalogRecord))
    .catch((error: unknown) => {
      catalog = undefined;
      throw error;
    });
  return matchBenefit(await catalog, texts);
}

/** Verified official apply pages, used when the live lookup fails or is too slow. */
const STATIC_PAGES: Readonly<Record<string, string>> = {
  pflegegeld: "https://www.pv.at/web/pflegegeld",
  "svbox-pflegegeld": "https://www.pv.at/web/pflegegeld",
  "medical-rehabilitation": "https://www.pv.at/web/reha-und-praevention/vom-antrag-zu-reha-und-kur",
  "svbox-kur-reha": "https://www.pv.at/web/reha-und-praevention/vom-antrag-zu-reha-und-kur",
};

const HOST_OWNERS: Readonly<Record<string, string>> = {
  "www.pv.at": "der PVA",
  "www.oegk.at": "der ÖGK",
  "www.svs.at": "der SVS",
  "www.bvaeb.at": "der BVAEB",
  "www.auva.at": "der AUVA",
  "www.sozialministeriumservice.gv.at": "des Sozialministeriumservice",
  "www.sozialministerium.gv.at": "des Sozialministeriums",
  "www.bmf.gv.at": "des Finanzministeriums",
  "www.fsw.at": "des Fonds Soziales Wien",
  "www.ams.at": "des AMS",
};

/** "die Seite der ÖGK" or, for portals, "die offizielle Seite auf oesterreich.gv.at". */
export function pageOwner(url: string): string {
  const host = new URL(url).hostname;
  const owner = HOST_OWNERS[host];
  return owner ? `die Seite ${owner}` : `die offizielle Seite auf ${host.replace(/^www\./u, "")}`;
}

export type ApplyPageChoice = ApplyPage & {
  benefit: string;
  formId?: string;
  sentence: string;
  label: string;
  fallback: boolean;
};

const LOOKUP_BUDGET_MS = 6_500;

/**
 * The official page to show before filling: the deepest apply page found live (catalog sources plus
 * an allowlisted search, at most two reads) within the budget, else the verified static page.
 */
export async function chooseApplyPage(input: {
  benefit?: CatalogBenefit | undefined;
  registered?: { formId: string; name: string } | undefined;
  model: LanguageModel;
  signal?: AbortSignal | undefined;
  budgetMs?: number;
  find?: typeof findApplyPage;
}): Promise<ApplyPageChoice | undefined> {
  const name = input.benefit?.name ?? input.registered?.name;
  if (!name) return;
  const query = `${name} Antrag`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), input.budgetMs ?? LOOKUP_BUDGET_MS);
  const signal = AbortSignal.any([timeout.signal, ...(input.signal ? [input.signal] : [])]);
  let found: ApplyPage | undefined;
  try {
    found = await Promise.race([
      (input.find ?? findApplyPage)({
        query,
        carrier: input.benefit?.carrier,
        known: input.benefit?.sources ?? [],
        model: input.model,
        signal,
      }),
      new Promise<undefined>((resolve) =>
        timeout.signal.addEventListener("abort", () => resolve(undefined)),
      ),
    ]);
  } catch {
    input.signal?.throwIfAborted();
    found = undefined;
  } finally {
    clearTimeout(timer);
  }
  if (found && !(await openResourceAllowed({ target: pageTarget(found.url) }))) found = undefined;
  const staticUrl =
    STATIC_PAGES[input.benefit?.id ?? ""] ?? STATIC_PAGES[input.registered?.formId ?? ""];
  const page = found ?? (staticUrl ? { url: staticUrl, title: "" } : undefined);
  if (!page) return;
  const owner = pageOwner(page.url);
  const fills = input.registered !== undefined || page.formPdf !== undefined;
  return {
    ...page,
    benefit: name,
    ...(input.registered ? { formId: input.registered.formId } : {}),
    label: `${owner} zu ${name}`,
    sentence: `Ich öffne ${owner} zu ${name} und zeige Ihnen, wo der Antrag steht.${fills ? " Danach fülle ich das Formular für Sie aus." : ""}`,
    fallback: !found,
  };
}

export function pageTarget(url: string) {
  return { kind: "dom" as const, handle: "page", url };
}

const opened = new Map<string, ApplyPageChoice>();

/** Remembers the page this flow opened, so the after-open turn knows its form or apply link. */
export function rememberApplyPage(choice: ApplyPageChoice): void {
  if (opened.size > 200) opened.delete(opened.keys().next().value ?? "");
  opened.set(choice.url, choice);
}

export function openedApplyPage(url: string): ApplyPageChoice | undefined {
  return opened.get(url);
}

/** No form to fill here: where and how to apply on the opened page, quoting its link. */
export function onlineApplyText(choice: ApplyPageChoice, english: boolean): string {
  const host = new URL(choice.url).hostname.replace(/^www\./u, "");
  const link = choice.apply?.text.replace(/[„“"]/gu, "").slice(0, 80);
  if (english)
    return link
      ? `On this page (${host}) you apply for ${choice.benefit} via “${link}”. There is no form for me to fill in; you sign in there yourself. I do not sign in or submit anything.`
      : `This page (${host}) explains how to apply for ${choice.benefit}. There is no form for me to fill in here. I do not sign in or submit anything.`;
  return link
    ? `Auf dieser Seite (${host}) beantragen Sie ${choice.benefit} über „${link}“. Ein Formular zum Ausfüllen gibt es dafür nicht; dort melden Sie sich selbst an. Ich melde mich nicht an und schicke nichts ab.`
    : `Auf dieser Seite (${host}) steht, wie Sie ${choice.benefit} beantragen. Ein Formular zum Ausfüllen gibt es hier nicht. Ich melde mich nicht an und schicke nichts ab.`;
}
