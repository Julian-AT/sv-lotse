import { expect, type Page } from "@playwright/test";
import { z } from "zod";

const OverlayPartSchema = z.object({
  part: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string(),
  background: z.string(),
  border: z.string(),
  opacity: z.string(),
  display: z.string(),
  visibility: z.string(),
  text: z.string(),
});
export type OverlayPart = z.infer<typeof OverlayPartSchema>;

interface InspectedNode {
  nodeId: number;
  attributes?: string[];
  children?: InspectedNode[];
  shadowRoots?: InspectedNode[];
  shadowRootType?: string;
}

// Only the external Chromium debugger can inspect the closed root. Do not patch
// attachShadow or expose the root to the fixture's scripts for geometry tests.
export async function inspectOverlay(page: Page): Promise<OverlayPart[]> {
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
    function findHost(node: InspectedNode): InspectedNode | undefined {
      if (node.attributes?.includes("data-lotse-guide")) return node;
      for (const child of node.children ?? []) {
        const found = findHost(child);
        if (found) return found;
      }
      return;
    }
    const host = findHost(root);
    const shadow = host?.shadowRoots?.find((node) => node.shadowRootType === "closed");
    expect(shadow, "overlay must have a closed shadow root").toBeDefined();
    if (!shadow) throw new Error("Missing closed overlay root");
    const { object } = await client.send("DOM.resolveNode", { nodeId: shadow.nodeId });
    if (!object.objectId) throw new Error("Missing debugger object");
    const result = await client.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: function (this: ShadowRoot) {
        return Array.from(this.querySelectorAll<HTMLElement>("[data-guide-part]"), (node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            part: node.dataset.guidePart,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            color: style.color,
            background: style.backgroundColor,
            border: style.border,
            opacity: style.opacity,
            display: style.display,
            visibility: style.visibility,
            text: node.textContent,
          };
        });
      }.toString(),
    });
    expect(result.exceptionDetails).toBeUndefined();
    return z.array(OverlayPartSchema).parse(result.result.value);
  } finally {
    await client.detach();
  }
}
