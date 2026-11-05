import type { Action } from "@lotse/protocol";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../browser.ts";
import { inspectOverlay } from "../inspect-overlay.ts";

async function start(page: Page) {
  await page.goto("/quotes.html");
  await page.addScriptTag({ type: "module", content: 'import "/test/browser.ts";' });
  await page.waitForFunction(() => !!window.guide);
}

test("FR-D4 resolves the unique visible occurrence when a repeated text-node line is clipped", async ({
  page,
}) => {
  await start(page);
  expect(
    await page.locator("#clipped-quote").evaluate((node) => {
      const text = node.firstChild;
      if (!text) throw new Error("Missing quote text");
      const range = document.createRange();
      range.setStart(text, 18);
      range.setEnd(text, 35);
      return Array.from(range.getClientRects()).every(
        (rect) => rect.top >= node.getBoundingClientRect().bottom,
      );
    }),
  ).toBe(true);
  const instruction: Action = {
    id: "clipped-quote",
    kind: "highlight",
    target: { kind: "text", quote: "Visible sentence." },
    payload: {},
    sentenceIndex: 0,
  };
  expect(await page.evaluate((value) => window.guide.execute(value), instruction)).toMatchObject({
    success: true,
  });
  const highlights = (await inspectOverlay(page)).filter((part) => part.part === "highlight");
  expect(highlights).toHaveLength(1);
  const bounds = await page.locator("#clipped-quote").boundingBox();
  if (!bounds || !highlights[0]) throw new Error("Missing quote geometry");
  expect(highlights[0].y).toBeGreaterThanOrEqual(bounds.y);
  expect(highlights[0].y + highlights[0].height).toBeLessThanOrEqual(bounds.y + bounds.height);
  // Removing the clip reveals a second occurrence and must restore ambiguity.
  await page.locator("#clipped-quote").evaluate((node: HTMLElement) => {
    node.style.height = "auto";
  });
  expect(await page.evaluate((value) => window.guide.execute(value), instruction)).toMatchObject({
    success: false,
    failureReason: "target-not-found",
  });
});

for (const display of ["inline-block", "inline-flex", "inline-grid", "inline-table"]) {
  test(`FR-D4 preserves adjacent ${display} text without inserting whitespace`, async ({
    page,
  }) => {
    await start(page);
    await page.locator("#inline-quote span").evaluateAll((nodes, display) => {
      for (const node of nodes) (node as HTMLElement).style.display = display;
    }, display);
    for (const [quote, success] of [
      ["Helloworld.", true],
      ["Hello world.", false],
      ["Block boundary.", true],
      ["Line break.", true],
    ] as const) {
      const instruction: Action = {
        id: "inline-quote",
        kind: "highlight",
        target: { kind: "text", quote },
        payload: {},
        sentenceIndex: 0,
      };
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject(success ? { success } : { success, failureReason: "target-not-found" });
    }
  });
}

for (const display of ["inline-flex", "inline-grid"]) {
  test(`FR-D4 preserves contiguous nested ${display} text despite blockified children`, async ({
    page,
  }) => {
    await start(page);
    await page.locator("#inline-quote > span").evaluateAll((nodes, display) => {
      for (const node of nodes) {
        (node as HTMLElement).style.display = display;
        const child = document.createElement("span");
        child.textContent = node.textContent;
        node.replaceChildren(child);
      }
    }, display);
    const items = await page.locator("#inline-quote > span > span").evaluateAll((nodes) =>
      nodes.map((node) => ({
        display: getComputedStyle(node).display,
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
      })),
    );
    expect(items.map((item) => item.display)).toEqual(["block", "block"]);
    const [first, second] = items;
    if (!first || !second) throw new Error("Missing nested text boxes");
    expect(Math.abs(first.right - second.left)).toBeLessThan(1);
    for (const [quote, success] of [
      ["Helloworld.", true],
      ["Hello world.", false],
    ] as const) {
      const instruction: Action = {
        id: "nested-inline-quote",
        kind: "highlight",
        target: { kind: "text", quote },
        payload: {},
        sentenceIndex: 0,
      };
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject(success ? { success } : { success, failureReason: "target-not-found" });
    }
  });
}
