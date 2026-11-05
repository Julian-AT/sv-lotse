export interface Overlay {
  contains(element: Element): boolean;
  point(rect: DOMRect): Promise<void>;
  highlight(rects: DOMRect[]): void;
  annotation(rect: DOMRect, text: string, ghost?: boolean): void;
  caption(text: string): void;
  clear(): void;
}

export function createOverlay(document: Document): Overlay {
  let host: HTMLDivElement | undefined;
  let root: ShadowRoot | undefined;
  let cursor: HTMLDivElement | undefined;
  let lastPosition: { x: number; y: number } | undefined;
  const animations = new Set<Animation>();

  function ensureRoot(): ShadowRoot {
    if (root && host?.isConnected) return root;
    host = document.createElement("div");
    host.setAttribute("data-lotse-guide", "");
    host.popover = "manual";
    // The host participates in the page cascade. Inline important declarations
    // protect it; the top layer also escapes clipped/transformed page ancestors.
    const properties: Record<string, string> = {
      all: "initial",
      display: "block",
      visibility: "visible",
      opacity: "1",
      color: "#000",
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      "max-width": "none",
      "max-height": "none",
      margin: "0",
      padding: "0",
      border: "0",
      overflow: "visible",
      background: "transparent",
      transform: "none",
      filter: "none",
      "clip-path": "none",
      "pointer-events": "none",
      "z-index": "2147483647",
      animation: "none",
      transition: "none",
      "content-visibility": "visible",
    };
    for (const [property, value] of Object.entries(properties))
      host.style.setProperty(property, value, "important");
    root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host::backdrop { background: transparent; pointer-events: none; }
      * { all: initial; box-sizing: border-box; pointer-events: none; }
      .cursor { position: fixed; width: 24px; height: 28px; background: #174bd1;
        clip-path: polygon(0 0, 0 100%, 30% 73%, 52% 100%, 72% 84%, 50% 60%, 100% 53%); }
      .highlight { position: fixed; border: 2px solid #174bd1; background: #3974ff24; border-radius: 3px; }
      .annotation, .ghost, .caption { position: fixed; display: block; color: #fff; background: #17305c;
        border: 2px solid #fff; border-radius: 8px; padding: 10px 14px; max-width: min(420px, 90vw);
        font: 500 18px/1.45 system-ui, sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; }
      .ghost { border-style: dashed; background: #fff; color: #17305c; border-color: #174bd1; }
      .caption { bottom: 24px; left: 50%; transform: translateX(-50%); max-width: 90vw; }
    `;
    root.append(style);
    (document.body ?? document.documentElement).append(host);
    if (typeof host.showPopover === "function") host.showPopover();
    return root;
  }

  function remove(part: string): void {
    for (const element of root?.querySelectorAll(`[data-guide-part="${part}"]`) ?? [])
      element.remove();
  }

  function node(part: string): HTMLDivElement {
    const element = document.createElement("div");
    element.className = part;
    element.setAttribute("data-guide-part", part);
    ensureRoot().append(element);
    return element;
  }

  return {
    contains: (element) => element === host,
    async point(rect) {
      ensureRoot();
      if (!cursor?.isConnected) cursor = node("cursor");
      cursor.setAttribute("aria-hidden", "true");
      const position = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      cursor.style.left = `${position.x}px`;
      cursor.style.top = `${position.y}px`;
      const previous = lastPosition ?? {
        x: Math.max(0, position.x - 80),
        y: Math.max(0, position.y - 40),
      };
      lastPosition = position;
      if (!document.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const animation = cursor.animate(
          [
            { transform: `translate(${previous.x - position.x}px, ${previous.y - position.y}px)` },
            {
              transform: `translate(${(previous.x - position.x) / 2}px, ${(previous.y - position.y) / 2 - 18}px)`,
              offset: 0.5,
            },
            { transform: "translate(0, 0)" },
          ],
          { duration: 180, easing: "ease-out" },
        );
        animations.add(animation);
        try {
          await animation.finished;
        } finally {
          animations.delete(animation);
        }
      }
    },
    highlight(rects) {
      remove("highlight");
      for (const rect of rects) {
        const element = node("highlight");
        element.setAttribute("aria-hidden", "true");
        Object.assign(element.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      }
    },
    annotation(rect, text, ghost = false) {
      remove(ghost ? "ghost" : "annotation");
      const element = node(ghost ? "ghost" : "annotation");
      element.textContent = text;
      const view = document.defaultView;
      const box = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(rect.right + 12, (view?.innerWidth ?? 0) - box.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(rect.top, (view?.innerHeight ?? 0) - box.height - 8))}px`;
    },
    caption(text) {
      remove("caption");
      const element = node("caption");
      element.setAttribute("role", "status");
      element.textContent = text;
    },
    clear() {
      for (const animation of animations) animation.cancel();
      animations.clear();
      host?.remove();
      host = undefined;
      root = undefined;
      cursor = undefined;
      lastPosition = undefined;
    },
  };
}
