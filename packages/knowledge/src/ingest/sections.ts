import { load } from "cheerio";
import { intersectValidity, preambleValidity, type Validity } from "./validity.ts";

export interface NormalizedSection extends Validity {
  markdown: string;
}

interface Scope extends Validity {
  parent: Scope | null;
}
interface Heading {
  level: number;
  markdown: string;
  scope: Scope;
}

// Preserve semantic containers as well as heading scopes. Heading text is not
// an identifier: repeated headings in separate containers must stay independent.
export function normalizeSections(
  html: string,
  convert: (html: string) => string,
  validity: Validity,
): NormalizedSection[] {
  const $ = load(html);
  // Flatten only neutral wrappers containing boundaries. All other markup
  // stays intact for Turndown, especially lists, tables and inline links.
  for (const node of $("div, header, main, span").toArray().reverse()) {
    const element = $(node);
    if (element.find("section, article, h1, h2, h3, h4, h5, h6").length) {
      element.replaceWith(element.contents());
    }
  }
  const root: Scope = { ...validity, parent: null };
  const parts: { html: string[]; headings: Heading[]; scope: Scope }[] = [];
  const visit = (nodes: ReturnType<typeof $>, base: Scope, inherited: Heading[]) => {
    let headings = [...inherited];
    let local: Heading[] = [];
    const active = () => local.at(-1)?.scope ?? base;
    for (const node of nodes.toArray()) {
      const element = $(node);
      if (element.is("section, article")) {
        const scope: Scope = { parent: active(), valid_from: null, valid_to: null };
        visit(element.contents(), scope, headings);
      } else if (element.is("h1, h2, h3, h4, h5, h6")) {
        const level = Number(element.prop("tagName")?.slice(1));
        headings = headings.filter((heading) => heading.level < level);
        local = local.filter((heading) => heading.level < level);
        const scope: Scope =
          level === 1 && base === root
            ? root
            : {
                parent: active(),
                valid_from: null,
                valid_to: null,
              };
        const heading = { level, markdown: convert($.html(node)), scope };
        headings.push(heading);
        local.push(heading);
      } else {
        if (!element.text().trim() && node.type === "text") continue;
        const scope = active();
        if (scope !== root) {
          const dates = preambleValidity($, element);
          scope.valid_from ??= dates.valid_from;
          scope.valid_to ??= dates.valid_to;
        }
        const previous = parts.at(-1);
        if (previous?.scope === scope && previous.headings.at(-1) === headings.at(-1)) {
          previous.html.push($.html(node));
        } else parts.push({ html: [$.html(node)], headings: [...headings], scope });
      }
    }
  };
  visit($("body").contents(), root, []);
  const effective = (scope: Scope): Validity =>
    scope.parent
      ? intersectValidity(effective(scope.parent), scope)
      : { valid_from: scope.valid_from, valid_to: scope.valid_to };
  return parts.flatMap((part) => {
    const body = convert(part.html.join("\n"));
    if (!body) return [];
    return [
      {
        markdown: [...part.headings.map((heading) => heading.markdown), body].join("\n\n"),
        ...effective(part.scope),
      },
    ];
  });
}
