import { load } from "cheerio";

export type PageLink = {
  text: string;
  href: string;
  pdf: boolean;
  form: boolean;
  apply: boolean;
};
export type PageField = { label: string; name: string; type: string };
export type PageStructure = {
  title: string;
  headings: string[];
  text: string;
  links: PageLink[];
  fields: PageField[];
};

const MAX_TEXT = 1_500;
const MAX_LINKS = 40;
const MAX_FIELDS = 30;
const FORM = /formular|\bforms?\b|vordruck/iu;
const APPLY = /antrag|beantrag|online.?beantragen|einreich/iu;
const SKIPPED_FIELDS = new Set([
  "hidden",
  "submit",
  "button",
  "image",
  "reset",
  "password",
  "file",
]);

const clean = (value: string | undefined) => (value ?? "").replace(/\s+/gu, " ").trim();

/**
 * Compact structure of an HTML page: title, headings, a main-text excerpt, the links accepted by
 * `allowLink` (most relevant first) and plain form fields. Everything returned is page data.
 */
export function readPageStructure(
  html: string,
  pageUrl: string,
  allowLink: (href: string) => boolean,
): PageStructure {
  const $ = load(html);
  $("script, style, noscript, template, svg, iframe").remove();
  const title = clean($("title").first().text()) || clean($("h1").first().text());
  const headings = $("h1, h2, h3")
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean)
    .slice(0, 20);

  const ranked: { link: PageLink; score: number }[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, element) => {
    const anchor = $(element);
    let href: URL;
    try {
      href = new URL(anchor.attr("href") ?? "", pageUrl);
    } catch {
      return;
    }
    href.hash = "";
    const label =
      clean(anchor.text()) || clean(anchor.attr("title")) || clean(anchor.attr("aria-label"));
    if (!label || seen.has(href.href) || !allowLink(href.href)) return;
    seen.add(href.href);
    const haystack = `${label} ${href.pathname}`;
    const link = {
      text: label.slice(0, 120),
      href: href.href,
      pdf: /\.pdf$/iu.test(href.pathname) || /\bpdf\b/iu.test(label),
      form: FORM.test(haystack),
      apply: APPLY.test(haystack),
    };
    const inContent = anchor.closest("main, article, [role=main]").length > 0;
    const score =
      Number(link.apply) * 3 + Number(link.form) * 2 + Number(link.pdf) + Number(inContent);
    ranked.push({ link, score });
  });

  const main =
    [$("main, [role=main]"), $("article")].find((candidate) => candidate.length > 0)?.first() ??
    $("body");
  main.find("nav, header, footer, aside").remove();

  const fields: PageField[] = [];
  $("form")
    .find("input, select, textarea")
    .each((_, element) => {
      const field = $(element);
      const type = (field.attr("type") ?? element.tagName).toLowerCase();
      if (SKIPPED_FIELDS.has(type) || fields.length >= MAX_FIELDS) return;
      const id = field.attr("id");
      const label =
        (id ? clean($(`label[for="${id}"]`).first().text()) : "") ||
        clean(field.closest("label").text()) ||
        clean(field.attr("aria-label")) ||
        clean(field.attr("placeholder"));
      fields.push({ label, name: field.attr("name") ?? id ?? "", type });
    });

  return {
    title,
    headings,
    text: clean(main.text()).slice(0, MAX_TEXT),
    links: ranked
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_LINKS)
      .map(({ link }) => link),
    fields,
  };
}
