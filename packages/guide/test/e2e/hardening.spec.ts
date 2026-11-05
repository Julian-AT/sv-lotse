import type { Action, Target } from "@lotse/protocol";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../browser.ts";

async function start(page: Page, fixture = "plain") {
  await page.goto(`/${fixture}.html`);
  await page.addScriptTag({ type: "module", content: 'import "/test/browser.ts";' });
  await page.waitForFunction(() => !!window.guide);
}

async function targetFor(page: Page, label: string): Promise<Target> {
  return page.evaluate((name) => {
    const snapshot = window.guide.snapshot();
    const field = snapshot.handles.find((entry) => entry.label === name);
    if (!field) throw new Error(`Missing field: ${name}`);
    return { kind: "dom", handle: field.handle, url: snapshot.url };
  }, label);
}

function typing(target: Target, value: string): Action {
  return {
    id: "hardening",
    kind: "type",
    target,
    payload: { value, pace: 20, provenance: { source: { kind: "statement" } } },
    sentenceIndex: 0,
  };
}

for (const [id, label] of [
  ["image-button", "Delete record"],
  ["image-link", "Remove record"],
  ["image-widget", "Send message"],
  ["labelled-image", "Pay now"],
  ["named-descendant", "Submit application"],
  ["split-text", "Delete draft"],
  ["whitespace-aria-label", "Delete entry"],
  ["whitespace-referenced-name", "Remove entry"],
  ["referenced-whitespace-label", "Delete document"],
] as const) {
  test(`E8 names ${id} from its descendants and denies its ${label} action`, async ({ page }) => {
    await start(page, "hardening");
    // The browser and the guide must expose the same alternative for this control.
    await expect(page.locator(`#${id}`)).toHaveAccessibleName(label);
    const target = await targetFor(page, label);
    for (const kind of ["point", "highlight", "annotate", "caption", "clear", "type"] as const) {
      const instruction: Action =
        kind === "type"
          ? typing(target, "Approved value")
          : { id: "image-action", kind, target, payload: {}, sentenceIndex: 0 };
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject({ success: false, failureReason: "denied" });
    }
    await expect(page.locator("[data-lotse-guide]")).toHaveCount(0);
  });
}

for (const role of ["form", "group", "region"]) {
  test(`FR-D7 allows an ordinary field beside a denied button in an ARIA ${role}`, async ({
    page,
  }) => {
    await start(page, "hardening");
    const target = await targetFor(page, `${role[0]?.toUpperCase()}${role.slice(1)} name`);
    expect(
      await page.evaluate((value) => window.guide.execute(value), typing(target, "Alex")),
    ).toMatchObject({ success: true });
    await expect(page.locator(`#${role}-name`)).toHaveValue("Alex");
    const snapshot = await page.evaluate(() => window.guide.snapshot());
    expect(snapshot.handles.find((entry) => entry.role === role)?.label).toBe("");
    await page.locator(`[role="${role}"]`).evaluate((node) => {
      node.setAttribute("aria-label", "Absenden");
    });
    expect(
      await page.evaluate((value) => window.guide.execute(value), typing(target, "Case")),
    ).toMatchObject({ success: true });
    await expect(page.locator(`#${role}-name`)).toHaveValue("Case");
    const deniedTarget = await page.locator(`[role="${role}"] button`).evaluate((node) => {
      node.setAttribute("aria-label", "Absenden now");
      const snapshot = window.guide.snapshot();
      const entry = snapshot.handles.find((entry) => entry.label === "Absenden now");
      if (!entry) throw new Error("Missing denied control");
      return { kind: "dom" as const, handle: entry.handle, url: snapshot.url };
    });
    const instruction: Action = {
      id: "denied-button",
      kind: "highlight",
      target: deniedTarget,
      payload: {},
      sentenceIndex: 0,
    };
    expect(await page.evaluate((value) => window.guide.execute(value), instruction)).toMatchObject({
      success: false,
      failureReason: "denied",
    });
  });
}

for (const event of ["input", "blur", "change"] as const) {
  for (const kind of ["type", "clear"] as const) {
    test(`FR-D7 reports nested-microtask ${event} validation rejecting ${kind}`, async ({
      page,
    }) => {
      await start(page);
      const target = await targetFor(page, "Full name");
      await page.locator("#name").evaluate(
        (field: HTMLInputElement, { event, kind }) => {
          field.value = kind === "type" ? "" : "Previous";
          field.addEventListener(event, () => {
            queueMicrotask(() => {
              queueMicrotask(() => {
                field.value = "Portal replacement";
              });
            });
          });
        },
        { event, kind },
      );
      const instruction: Action =
        kind === "type"
          ? typing(target, "A")
          : { id: "clear", kind, target, payload: {}, sentenceIndex: 0 };
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject({ success: false, failureReason: "value-changed" });
      await expect(page.locator("#name")).toHaveValue("Portal replacement");
    });

    test(`FR-D7 reports deferred ${event} validation rejecting ${kind}`, async ({ page }) => {
      await start(page);
      const target = await targetFor(page, "Full name");
      await page.locator("#name").evaluate(
        (field: HTMLInputElement, { event, kind }) => {
          // One input event on the last character exercises the final value check.
          field.value = kind === "type" ? "" : "Previous";
          field.addEventListener(event, () => {
            queueMicrotask(() => {
              field.value = "Portal replacement";
            });
          });
        },
        { event, kind },
      );
      const instruction: Action =
        kind === "type"
          ? typing(target, "A")
          : { id: "clear", kind, target, payload: {}, sentenceIndex: 0 };
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject({ success: false, failureReason: "value-changed" });
      await expect(page.locator("#name")).toHaveValue("Portal replacement");
    });
  }
}

for (const phase of ["pointing", "beforeinput", "between-characters"] as const) {
  for (const refresh of [false, true]) {
    test(`FR-D7 refuses a changed identity during ${phase}, snapshot refresh=${refresh}`, async ({
      page,
    }) => {
      await start(page);
      const target = await targetFor(page, "Full name");
      const result = await page.evaluate(
        async ({ instruction, phase, refresh }) => {
          const field = document.querySelector<HTMLInputElement>("#name");
          if (!field) throw new Error("Missing fixture field");
          field.value = "";
          const repurpose = () => {
            field.setAttribute("aria-label", "Repurposed field");
            if (refresh) window.guide.snapshot();
          };
          if (phase === "beforeinput")
            field.addEventListener("beforeinput", repurpose, { once: true });
          if (phase === "between-characters")
            field.addEventListener("input", () => queueMicrotask(repurpose), { once: true });
          const pending = window.guide.execute(instruction);
          if (phase === "pointing") repurpose();
          return pending;
        },
        { instruction: typing(target, "Alex"), phase, refresh },
      );
      expect(result).toMatchObject({ success: false, failureReason: "target-not-found" });
      const expected = phase === "between-characters" ? "A" : "";
      await expect(page.locator("#name")).toHaveValue(expected);
      expect(
        await page.evaluate(() =>
          window.observed.filter((entry) => entry.type === "input").map((entry) => entry.value),
        ),
      ).toEqual(expected ? [expected] : []);
    });
  }
}
