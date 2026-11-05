import { load } from "cheerio";
import TurndownService from "turndown";
import { z } from "zod";

export interface NormalizedPage {
  title: string;
  markdown: string;
  language: string;
  valid_from: string | null;
  valid_to: string | null;
}

function explicitDate(value: string | undefined): string | null {
  if (!value) return null;
  const german = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  const date = german ? `${german[3]}-${german[2]}-${german[1]}` : value;
  if (z.iso.date().safeParse(date).success) return `${date}T00:00:00.000Z`;
  if (z.iso.datetime({ offset: true }).safeParse(date).success) return new Date(date).toISOString();
  return null;
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
    "script, style, noscript, nav, footer, aside, form, iframe, [role=navigation], [role=banner], [role=contentinfo]",
  ).remove();
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
  const labels: string[] = [];
  // Only direct page-preamble labels are global. Stop at the first subsection;
  // nested dates remain verbatim section prose and never bound other chunks.
  main.children().each((_, element) => {
    const child = $(element);
    if (child.is("section, article, h2, h3, h4, h5, h6") || child.find("h2, h3, h4, h5, h6").length)
      return false;
    if (child.is("p, time")) labels.push(child.text().trim());
  });
  const text = labels.join("\n");
  valid_from ??= explicitDate(
    /^Gültig (?:ab|von):?\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\s*$/im.exec(text)?.[1],
  );
  valid_to ??= explicitDate(
    /^Gültig bis:?\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\s*$/im.exec(text)?.[1],
  );
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
      if (width === 0) return "";
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
      return `\n\n${[render(header), render(Array.from({ length: width }, () => "---")), ...rows.slice(headerRows).map(render)].join("\n")}\n\n`;
    },
  });
  const markdown = converter
    .turndown(main.html() ?? "")
    .replace(/\u00ad/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, markdown, language, valid_from, valid_to };
}
