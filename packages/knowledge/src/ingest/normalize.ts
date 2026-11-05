import { load } from "cheerio";
import TurndownService from "turndown";
import { type NormalizedSection, normalizeSections } from "./sections.ts";
import { explicitDate, preambleValidity } from "./validity.ts";

export interface NormalizedPage {
  title: string;
  markdown: string;
  language: string;
  valid_from: string | null;
  valid_to: string | null;
  sections: NormalizedSection[];
}

export function normalizeHtml(html: string, url: string): NormalizedPage {
  const $ = load(html);
  const language = $("html").attr("lang")?.trim() || "de";
  // Publication/modified dates are deliberately not treated as legal validity.
  let valid_from = explicitDate(
    $('head meta[name="valid_from"], head meta[itemprop="validFrom"]').first().attr("content"),
  );
  let valid_to = explicitDate(
    $('head meta[name="valid_to"], head meta[itemprop="validThrough"]').first().attr("content"),
  );
  const documentTitle = $("title").first().text().trim();
  // Collapsed accordions often carry real administrative content. Visibility
  // attributes alone are not a reliable signal for navigation or boilerplate.
  $(
    "script, style, noscript, nav, footer, aside, iframe, input, button, select, textarea, [role=navigation], [role=banner], [role=contentinfo]",
  ).remove();
  // Forms can be layout containers around the article. Remove their controls,
  // but unwrap the container before selecting the main content.
  $("form").each((_, element) => {
    const form = $(element);
    form.replaceWith(form.contents());
  });
  $("[class*=cookie], [id*=cookie], .breadcrumb, .breadcrumbs").remove();
  let main = $("main, [role=main], article").first();
  if (main.length === 0) {
    // Readability-style fallback: prefer dense prose over link-heavy containers.
    let score = 0;
    main = $("body");
    $("section, div").each((_, element) => {
      const candidate = $(element);
      const candidateScore =
        candidate.find("p, li, td").text().length - candidate.find("a").text().length;
      if (candidateScore > score) {
        score = candidateScore;
        main = candidate;
      }
    });
  }
  const hasPageHeading = main.find("h1").length > 0;
  main.find('[role="heading"]').each((_, element) => {
    const heading = $(element);
    const ariaLevel = Number(heading.attr("aria-level") ?? 2);
    const level = Number.isInteger(ariaLevel) && ariaLevel >= 1 && ariaLevel <= 6 ? ariaLevel : 2;
    // Some accordions number their own headings from one. Keep them beneath
    // the native page title, while retaining deeper semantic heading levels.
    const nativeHeading = /^h[1-6]$/.test(element.tagName);
    const tag = `h${hasPageHeading && !nativeHeading ? Math.max(2, level) : level}`;
    heading.find('a[aria-controls][href^="#"]').each((_, control) => {
      const link = $(control);
      link.replaceWith(link.contents());
    });
    heading.replaceWith($(`<${tag}></${tag}>`).html(heading.html() ?? ""));
  });
  const title = main.find("h1").first().text().trim() || documentTitle || new URL(url).hostname;
  // Neutral layout wrappers do not change scope. Walk in document order so a
  // wrapper containing both the preamble and a subsection retains only the former.
  const preamble = preambleValidity($, main.children());
  valid_from ??= preamble.valid_from;
  valid_to ??= preamble.valid_to;
  main.find('img:not([alt]), img[alt=""]').remove();
  main.find("a").each((_, element) => {
    if (!$(element).text().trim() && $(element).find("img").length === 0) $(element).remove();
  });
  main.find("a[href]").each((_, element) => {
    const link = $(element);
    try {
      const target = new URL(link.attr("href") ?? "", url);
      if (
        ["http:", "https:", "mailto:", "tel:"].includes(target.protocol) &&
        !target.username &&
        !target.password
      )
        link.attr("href", target.href);
      else link.removeAttr("href");
    } catch {
      link.removeAttr("href");
    }
  });
  const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  converter.addRule("tables", {
    filter: "table",
    replacement: (_content, node) => {
      const table = load(node.outerHTML);
      const root = table("table").first();
      const caption = converter
        .turndown(root.children("caption").html() ?? "")
        .replace(/\s*\n+\s*/g, " ")
        .trim();
      const elements = root
        .find("tr")
        .filter((_, row) => table(row).closest("table")[0] === root[0])
        .toArray();
      const rows: string[][] = elements.map(() => []);
      const span = (value: string | undefined, maximum: number) => {
        const parsed = Number.parseInt(value ?? "1", 10);
        return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : 1;
      };
      for (const [rowIndex, element] of elements.entries()) {
        const row = rows[rowIndex];
        if (!row) continue;
        const groupEnd = elements.findIndex(
          (candidate, index) => index > rowIndex && candidate.parent !== element.parent,
        );
        const remaining = (groupEnd < 0 ? elements.length : groupEnd) - rowIndex;
        let column = 0;
        for (const cell of table(element).children("th, td").toArray()) {
          while (row[column] !== undefined) column++;
          const content = converter
            .turndown(table(cell).html() ?? "")
            .replace(/\|/g, "\\|")
            .replace(/\n+/g, "<br>");
          const colspan = span(table(cell).attr("colspan"), 1000);
          const rowspan =
            table(cell).attr("rowspan") === "0"
              ? remaining
              : span(table(cell).attr("rowspan"), remaining);
          // Markdown has no merged cells. Repeat the shared value in every
          // covered grid position so carrier/region columns stay associated.
          for (let down = 0; down < rowspan; down++) {
            for (let across = 0; across < colspan; across++) {
              const target = rows[rowIndex + down];
              if (!target) continue;
              if (target[column + across] !== undefined) throw new Error("Overlapping table spans");
              target[column + across] = content;
            }
          }
          column += colspan;
        }
      }
      const width = Math.max(0, ...rows.map((row) => row.length));
      if (width === 0) return caption ? `\n\n${caption}\n\n` : "";
      const render = (row: string[]) =>
        `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
      const hasHeader = table(elements[0]).children("th").length > 0;
      let headerRows = hasHeader ? 1 : 0;
      while (hasHeader && headerRows < elements.length) {
        const next = elements[headerRows];
        if (
          next?.parent !== elements[0]?.parent ||
          table(next).children("td").length ||
          !table(next).children("th").length
        )
          break;
        headerRows++;
      }
      // Markdown has a single header row. Combine the expanded header path for
      // each column so a grouped carrier label remains attached to its values.
      const header = Array.from({ length: width }, (_, column) =>
        [
          ...new Set(
            rows
              .slice(0, headerRows)
              .map((row) => row[column])
              .filter(Boolean),
          ),
        ].join(" / "),
      );
      // One block keeps the qualification attached to every row, including
      // when the entire captioned table exceeds the normal chunk limit.
      return `\n\n${[caption, render(header), render(Array.from({ length: width }, () => "---")), ...rows.slice(headerRows).map(render)].filter(Boolean).join("\n")}\n\n`;
    },
  });
  const convert = (html: string) =>
    converter
      .turndown(html)
      .replace(/\u00ad/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const content = main.html() ?? "";
  return {
    title,
    markdown: convert(content),
    language,
    valid_from,
    valid_to,
    sections: normalizeSections(content, convert, { valid_from, valid_to }),
  };
}
