import type { Target } from "@lotse/protocol";
import { isRendered, normalizeWhitespace, visibleRects } from "./snapshot/index.ts";

export interface ResolvedTarget {
  element: Element;
  rects: DOMRect[];
}

function visibleQuote(
  document: Document,
  quote: string,
  excluded: (element: Element) => boolean,
): ResolvedTarget | undefined {
  const window = document.defaultView;
  if (!window) return;
  const view = window;
  type Position = { node: Text; offset: number };
  const positions: (Position | undefined)[] = [];
  let text = "";
  function append(character: string, position?: Position) {
    if (/\s/u.test(character)) {
      if (text.endsWith(" ")) return;
      character = " ";
    }
    text += character;
    positions.push(position);
  }
  function visit(element: Element) {
    if (
      excluded(element) ||
      ["script", "style", "noscript", "template", "select", "textarea"].includes(
        element.localName,
      ) ||
      !isRendered(element)
    )
      return;
    const block = !["inline", "contents"].includes(view.getComputedStyle(element).display);
    if (block) append(" ");
    for (const child of element.childNodes) {
      if (child.nodeType === 1) visit(child as Element);
      else if (child.nodeType === 3) {
        const node = child as Text;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (!visibleRects(element, Array.from(range.getClientRects()), true).length) continue;
        for (let offset = 0; offset < node.length; offset++)
          append(node.data.charAt(offset), { node, offset });
      }
    }
    if (element.localName === "br" || block) append(" ");
  }
  visit(document.body ?? document.documentElement);
  const needle = normalizeWhitespace(quote);
  if (!needle) return;
  const index = text.indexOf(needle);
  // Repeated quotes need a narrower target rather than silently picking one.
  if (index < 0 || text.indexOf(needle, index + 1) >= 0) return;
  const start = positions[index];
  const end = positions[index + needle.length - 1];
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  const ancestor = range.commonAncestorContainer;
  const element = ancestor.nodeType === 1 ? (ancestor as Element) : ancestor.parentElement;
  const rects = element ? visibleRects(element, Array.from(range.getClientRects()), true) : [];
  return element && rects.length ? { element, rects } : undefined;
}

export function resolveTarget(
  document: Document,
  target: Target,
  lookup: (handle: string) => Element | undefined,
  excluded: (element: Element) => boolean,
): ResolvedTarget | undefined {
  if (target.kind === "text") {
    if (target.documentId !== undefined || target.page !== undefined) return;
    return visibleQuote(document, target.quote, excluded);
  }
  if (target.kind !== "dom" || target.url !== document.location.href) return;
  const element = lookup(target.handle);
  const rects = element ? visibleRects(element, [element.getBoundingClientRect()]) : [];
  return element && rects.length ? { element, rects } : undefined;
}
