import { type BoundingBox, type ContextCapsule, ContextCapsuleSchema } from "@lotse/protocol";
import { type DenyList, defaultDenyList, isCredentialControl } from "../safety.ts";

export interface PageHandle {
  handle: string;
  role: string;
  label: string;
  value: string;
  visible: boolean;
  credential: boolean;
  bbox: BoundingBox;
}

export interface PageSnapshot {
  url: string;
  handles: PageHandle[];
}

export type CapsulePage = NonNullable<ContextCapsule["page"]>;

export function toCapsulePage(snapshot: PageSnapshot): CapsulePage {
  return ContextCapsuleSchema.shape.page.unwrap().parse({
    url: snapshot.url,
    handles: snapshot.handles
      .filter((entry) => entry.visible && !entry.credential)
      .map(({ handle, role, label, value, bbox }) => ({
        id: handle,
        role,
        label,
        value,
        bbox,
      })),
  });
}

export const normalizeWhitespace = (text: string): string => text.replace(/\s+/gu, " ").trim();

// ARIA roles that support an accessible name derived from descendant content.
const nameFromContentRoles = new Set([
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "gridcell",
  "heading",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "row",
  "rowheader",
  "switch",
  "tab",
  "tooltip",
  "treeitem",
]);

function contentName(element: Element, seen: Set<Element>): string {
  return Array.from(element.childNodes, (child) => {
    if (child.nodeType === 3) return child.textContent ?? "";
    if (child.nodeType !== 1) return "";
    const descendant = child as Element;
    if (["script", "style", "noscript", "template"].includes(descendant.localName)) return "";
    if (descendant.localName === "br") return " ";
    const name = referencedName(descendant, seen);
    // Alternatives are separate name tokens; ordinary inline text stays contiguous.
    const alternative = ["aria-label", "aria-labelledby", "alt"].some((attribute) =>
      descendant.getAttribute(attribute)?.trim(),
    );
    const titleOnly = descendant.hasAttribute("title") && !descendant.textContent?.trim();
    return alternative || titleOnly ? ` ${name} ` : name;
  }).join("");
}

function referencedName(element: Element, seen: Set<Element>): string {
  if (seen.has(element)) return "";
  seen.add(element);
  const references = element.getAttribute("aria-labelledby")?.trim().split(/\s+/u) ?? [];
  const names = references
    .map((id) => {
      const label = element.ownerDocument.getElementById(id);
      return label ? normalizeWhitespace(referencedName(label, seen)) : "";
    })
    .filter(Boolean);
  if (names.length) return names.join(" ");
  return (
    normalizeWhitespace(element.getAttribute("aria-label") ?? "") ||
    element.getAttribute("alt") ||
    contentName(element, seen) ||
    element.getAttribute("title") ||
    ""
  );
}

export function accessibleName(element: Element): string {
  const references = element.getAttribute("aria-labelledby")?.trim().split(/\s+/u) ?? [];
  const referenced = references
    .map((id) => {
      const label = element.ownerDocument.getElementById(id);
      return label ? normalizeWhitespace(referencedName(label, new Set([element]))) : "";
    })
    .filter(Boolean)
    .join(" ");
  if (normalizeWhitespace(referenced)) return normalizeWhitespace(referenced);
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel?.trim()) return normalizeWhitespace(ariaLabel);
  if ("labels" in element) {
    const labels = Array.from((element as HTMLInputElement).labels ?? []);
    const label = normalizeWhitespace(
      labels.map((entry) => contentName(entry, new Set([element, entry]))).join(" "),
    );
    if (label) return label;
  }
  const tag = element.localName;
  if (
    tag === "input" &&
    ["button", "submit", "reset"].includes((element as HTMLInputElement).type)
  ) {
    const input = element as HTMLInputElement;
    return normalizeWhitespace(
      input.value || (input.type === "submit" ? "Submit" : input.type === "reset" ? "Reset" : ""),
    );
  }
  if (nameFromContentRoles.has(roleOf(element))) {
    const content = normalizeWhitespace(contentName(element, new Set([element])));
    if (content) return content;
  }
  return normalizeWhitespace(
    element.getAttribute("alt") ||
      element.getAttribute("title") ||
      element.getAttribute("placeholder") ||
      "",
  );
}

export function roleOf(element: Element): string {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/u)[0];
  if (explicit) return explicit;
  switch (element.localName) {
    case "input": {
      const type = (element as HTMLInputElement).type;
      if (["submit", "reset", "image", "button"].includes(type)) return "button";
      if (["checkbox", "radio"].includes(type)) return type;
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    case "select":
      return (element as HTMLSelectElement).multiple ? "listbox" : "combobox";
    case "textarea":
      return "textbox";
    case "a":
      return "link";
    case "button":
    case "summary":
      return "button";
    default:
      return element.hasAttribute("contenteditable") ? "textbox" : "generic";
  }
}

export function isRendered(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view || !element.isConnected) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (
      node.hasAttribute("hidden") ||
      node.hasAttribute("inert") ||
      node.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.contentVisibility === "hidden" ||
      Number(style.opacity) === 0
    )
      return false;
  }
  const visibility = view.getComputedStyle(element).visibility;
  return visibility !== "hidden" && visibility !== "collapse";
}

export function inViewport(rect: DOMRect, document: Document): boolean {
  const view = document.defaultView;
  return (
    !!view &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < view.innerWidth &&
    rect.top < view.innerHeight
  );
}

export function isVisible(element: Element): boolean {
  return visibleRects(element).length > 0;
}

export function visibleRects(
  element: Element,
  rects = Array.from(element.getClientRects()),
  clipSelf = false,
): DOMRect[] {
  const view = element.ownerDocument.defaultView;
  if (!view || !isRendered(element)) return [];
  return rects.flatMap((rect) => {
    if (!inViewport(rect, element.ownerDocument)) return [];
    let left = Math.max(0, rect.left);
    let top = Math.max(0, rect.top);
    let right = Math.min(view.innerWidth, rect.right);
    let bottom = Math.min(view.innerHeight, rect.bottom);
    for (let node = clipSelf ? element : element.parentElement; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      const clipsX = style.overflowX !== "visible";
      const clipsY = style.overflowY !== "visible";
      if (!clipsX && !clipsY) continue;
      const bounds = node.getBoundingClientRect();
      const scaleX =
        node instanceof view.HTMLElement && node.offsetWidth > 0
          ? bounds.width / node.offsetWidth
          : 1;
      const scaleY =
        node instanceof view.HTMLElement && node.offsetHeight > 0
          ? bounds.height / node.offsetHeight
          : 1;
      const clipLeft = bounds.left + node.clientLeft * scaleX;
      const clipTop = bounds.top + node.clientTop * scaleY;
      if (clipsX) {
        left = Math.max(left, clipLeft);
        right = Math.min(right, clipLeft + node.clientWidth * scaleX);
      }
      if (clipsY) {
        top = Math.max(top, clipTop);
        bottom = Math.min(bottom, clipTop + node.clientHeight * scaleY);
      }
    }
    return right > left && bottom > top
      ? [new view.DOMRect(left, top, right - left, bottom - top)]
      : [];
  });
}

function normalizedBox(element: Element): BoundingBox {
  const bounds = element.getBoundingClientRect();
  const rect = visibleRects(element, [bounds])[0] ?? bounds;
  const view = element.ownerDocument.defaultView;
  const width = Math.max(1, view?.innerWidth ?? 1);
  const height = Math.max(1, view?.innerHeight ?? 1);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x = clamp(rect.left / width);
  const y = clamp(rect.top / height);
  return {
    x,
    y,
    width: Math.max(0, clamp(rect.right / width) - x),
    height: Math.max(0, clamp(rect.bottom / height) - y),
  };
}

function currentValue(element: Element, credential: boolean): string {
  if (credential) return "";
  if (["input", "select", "textarea"].includes(element.localName))
    return (element as HTMLInputElement).value;
  return element.getAttribute("aria-valuetext") ?? element.getAttribute("aria-valuenow") ?? "";
}

function hash(text: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(index);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function structure(element: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.id) {
      parts.unshift(`${node.localName}#${node.id}`);
      break;
    }
    parts.unshift(
      `${node.localName}[${node.getAttribute("name") ?? ""}][${node.getAttribute("role") ?? ""}]`,
    );
  }
  return parts.join("/");
}

function semanticKey(element: Element, role: string, label: string): string {
  return JSON.stringify([
    element.localName,
    element.getAttribute("type"),
    element.getAttribute("name"),
    role,
    label,
  ]);
}

// Ordinals distinguish semantic duplicates only; issued handles are never recycled.
export function createSnapshotter(
  document: Document,
  excluded: (element: Element) => boolean,
  denyList: DenyList = defaultDenyList,
) {
  const identities = new WeakMap<Element, { key: string; handle: string }>();
  const issued = new Set<string>();
  const retired = new Set<string>();
  const replacements = new Map<string, string>();
  const ambiguous = new Set<string>();
  let elements = new Map<string, Element>();
  return {
    capture(): PageSnapshot {
      const idCounts = new Map<string, number>();
      for (const element of document.querySelectorAll("[id]"))
        idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1);
      const candidates = Array.from(
        document.querySelectorAll(
          "input,select,textarea,button,a[href],summary,[role],[contenteditable='true'],[tabindex]",
        ),
      )
        .filter((element) => !excluded(element))
        .map((element) => {
          const role = roleOf(element);
          const label = accessibleName(element);
          const key = semanticKey(element, role, label);
          let stable = !!element.getAttribute("name");
          for (let node: Element | null = element; node; node = node.parentElement) {
            if (node.id) {
              stable = idCounts.get(node.id) === 1;
              break;
            }
          }
          const structuralKey = `${structure(element)}:${key}`;
          return { element, role, label, key, structuralKey, stable };
        });
      const counts = new Map<string, number>();
      for (const { structuralKey } of candidates)
        counts.set(structuralKey, (counts.get(structuralKey) ?? 0) + 1);
      for (const [key, count] of counts) {
        if (count > 1) {
          // Once a structure is ambiguous, later deletion cannot prove which
          // person's control a newly created node represents.
          ambiguous.add(key);
          replacements.delete(key);
        }
      }
      const reserved = new Set<string>();
      for (const { element, key } of candidates) {
        const identity = identities.get(element);
        if (identity?.key !== key) continue;
        // A detached original can return after its handle was rebound. Neither
        // node may then claim an approval whose identity is now ambiguous.
        if (reserved.has(identity.handle)) retired.add(identity.handle);
        reserved.add(identity.handle);
      }
      elements = new Map();
      const handles = candidates.map(({ element, role, label, key, structuralKey, stable }) => {
        const previous = identities.get(element);
        let handle = previous?.key === key && !retired.has(previous.handle) ? previous.handle : "";
        if (!handle && stable && !ambiguous.has(structuralKey)) {
          const replacement = replacements.get(structuralKey);
          if (replacement && !reserved.has(replacement) && !retired.has(replacement))
            handle = replacement;
        }
        if (!handle) {
          const base = `g-${hash(structuralKey)}`;
          handle = base;
          let ordinal = 1;
          while (issued.has(handle)) handle = `${base}-${++ordinal}`;
          issued.add(handle);
        }
        reserved.add(handle);
        identities.set(element, { key, handle });
        if (stable && !ambiguous.has(structuralKey)) replacements.set(structuralKey, handle);
        elements.set(handle, element);
        const control = {
          inputType: element.localName === "input" ? (element as HTMLInputElement).type : "",
          autocomplete: element.getAttribute("autocomplete"),
        };
        const credential =
          isCredentialControl(control, defaultDenyList) || isCredentialControl(control, denyList);
        return {
          handle,
          role,
          label,
          value: currentValue(element, credential),
          visible: isVisible(element),
          credential,
          bbox: normalizedBox(element),
        };
      });
      return { url: document.location.href, handles };
    },
    element(handle: string): Element | undefined {
      const element = elements.get(handle);
      if (!element) return;
      const identity = identities.get(element);
      // Page listeners can repurpose a surviving node without another capture.
      return identity?.handle === handle &&
        identity.key === semanticKey(element, roleOf(element), accessibleName(element))
        ? element
        : undefined;
    },
  };
}
