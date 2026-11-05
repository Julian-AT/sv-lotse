import type { Action, Target } from "@lotse/protocol";
import { expect, type Page, test } from "@playwright/test";
import type { GuideOptions } from "../../src/index.ts";
import type {} from "../browser.ts";
import { inspectOverlay } from "../inspect-overlay.ts";

async function start(
  page: Page,
  fixture = "plain",
  options: Partial<Omit<GuideOptions, "document">> = {},
) {
  await page.goto(`/${fixture}.html`);
  await page.evaluate((configuration) => {
    window.guideOptions = configuration;
  }, options);
  await page.addScriptTag({ type: "module", content: 'import "/test/browser.ts";' });
  await page.waitForFunction(() => !!window.guide);
}

test("AC2 points and highlights DOM handles and exact whitespace-normalized quotes", async ({
  page,
}) => {
  await start(page);
  for (const target of [
    await targetFor(page, "Full name"),
    { kind: "text", quote: "Bring the completed   form to the office." } satisfies Target,
  ]) {
    const boxes = await page.evaluate((kind) => {
      const element = document.querySelector(kind === "dom" ? "#name" : "#quote");
      if (!element) throw new Error("Missing fixture target");
      const box = (rect: DOMRect) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      if (kind === "dom") return [box(element.getBoundingClientRect())];
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects(), box);
    }, target.kind);
    for (const kind of ["point", "highlight"] as const) {
      expect(
        await page.evaluate(
          (instruction) => window.guide.execute(instruction),
          action(kind, target),
        ),
      ).toMatchObject({ success: true, resolvedBy: "dom" });
      const parts = await inspectOverlay(page);
      const firstBox = boxes[0];
      if (!firstBox) throw new Error("Missing target rectangle");
      if (kind === "point") {
        const cursor = parts.find((part) => part.part === "cursor");
        expect(cursor).toBeDefined();
        expect(Math.abs((cursor?.x ?? -1) - (firstBox.x + firstBox.width / 2))).toBeLessThanOrEqual(
          2,
        );
        expect(
          Math.abs((cursor?.y ?? -1) - (firstBox.y + firstBox.height / 2)),
        ).toBeLessThanOrEqual(2);
      } else {
        const highlights = parts.filter((part) => part.part === "highlight");
        expect(highlights).toHaveLength(boxes.length);
        for (const [index, part] of highlights.entries()) {
          const expected = boxes[index];
          if (!expected) throw new Error("Missing highlight rectangle");
          for (const coordinate of ["x", "y", "width", "height"] as const)
            expect(Math.abs(part[coordinate] - expected[coordinate])).toBeLessThanOrEqual(2);
        }
      }
      await page.evaluate(() => window.guide.clear());
    }
  }
});

const hidingStyles =
  "display:none !important; visibility:hidden !important; opacity:0 !important; color:red !important; transform:scale(0) !important; width:0 !important; height:0 !important; pointer-events:auto !important";
for (const [selector, declarations] of [
  ["body *", hidingStyles],
  ["*", "opacity:0 !important; color:red !important"],
  ["div", hidingStyles],
  ["[data-lotse-guide]", hidingStyles],
  ["[popover]", hidingStyles],
  ["body > *", hidingStyles],
] as const) {
  test(`AC5 closed shadow content survives page CSS targeting ${selector}`, async ({ page }) => {
    await start(page, "hostile", { ghostPreview: true });
    const stylesBefore = await page.locator("style").allTextContents();
    const target = await targetFor(page, "Reference");
    for (const kind of ["point", "highlight", "annotate", "caption"] as const) {
      const instruction = action(kind, target);
      instruction.payload = { label: "Read this exact sentence." };
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject({ success: true });
    }
    expect(
      await page.evaluate((value) => window.guide.execute(value), typing(target, "Approved value")),
    ).toMatchObject({ success: true });
    expect(await page.locator("style").allTextContents()).toEqual(stylesBefore);
    const before = await inspectOverlay(page);
    expect(before.map((part) => part.part).sort()).toEqual([
      "annotation",
      "caption",
      "cursor",
      "ghost",
      "highlight",
    ]);
    const caption = before.find((part) => part.part === "caption");
    if (!caption) throw new Error("Missing caption");
    // Compare the opaque caption interior to prove it is still painted even
    // when universal opacity rules affect the page's ancestors.
    const clip = {
      x: caption.x + 12,
      y: caption.y + 12,
      width: caption.width - 24,
      height: caption.height - 24,
    };
    const painted = await page.screenshot({ clip });
    const host = page.locator("[data-lotse-guide]");
    expect(await host.evaluate((node, value) => node.matches(value), selector)).toBe(true);
    expect(
      await host.evaluate((node: HTMLElement) =>
        [
          "all",
          "display",
          "visibility",
          "opacity",
          "position",
          "width",
          "height",
          "transform",
          "pointer-events",
        ].every((property) => node.style.getPropertyPriority(property) === "important"),
      ),
    ).toBe(true);
    await page.evaluate(([rule, styles]) => window.attackOverlay(rule, styles), [
      selector,
      declarations,
    ] as const);
    await expect(host).toBeVisible();
    expect(await inspectOverlay(page)).toEqual(before);
    expect(await page.screenshot({ clip })).toEqual(painted);
    expect(await page.evaluate(() => window.inspectOverlay())).toEqual({
      foundNodes: 0,
      firstNode: null,
      shadow: null,
    });
    await page.evaluate(() => window.guide.clear());
    await expect(host).toHaveCount(0);
  });
}

test("AC3 visibly types each character with keyboard and input events at the approved pace", async ({
  page,
}) => {
  await start(page);
  const target = await targetFor(page, "Full name");
  const instruction: Action = {
    id: "typing",
    kind: "type",
    target,
    sentenceIndex: 0,
    payload: { value: "Alex", pace: 40, provenance: { source: { kind: "statement" } } },
  };
  expect(await page.evaluate((value) => window.guide.execute(value), instruction)).toMatchObject({
    success: true,
  });
  expect(await page.locator("#name").inputValue()).toBe("Alex");
  const events = await page.evaluate(() => window.observed);
  expect(events.filter((event) => event.type === "input").map((event) => event.value)).toEqual([
    "",
    "A",
    "Al",
    "Ale",
    "Alex",
  ]);
  expect(events.filter((event) => event.type === "keydown").map((event) => event.key)).toEqual([
    "Backspace",
    "A",
    "l",
    "e",
    "x",
  ]);
  expect(events.filter((event) => event.type === "keyup").map((event) => event.key)).toEqual([
    "Backspace",
    "A",
    "l",
    "e",
    "x",
  ]);
  expect(events.filter((event) => event.type === "beforeinput").map((event) => event.data)).toEqual(
    [null, "A", "l", "e", "x"],
  );
  const inputs = events.filter((event) => event.type === "input" && event.data !== null);
  for (let index = 1; index < inputs.length; index++)
    expect((inputs[index]?.time ?? 0) - (inputs[index - 1]?.time ?? 0)).toBeGreaterThanOrEqual(34);
  expect((inputs.at(-1)?.time ?? 0) - (inputs[0]?.time ?? 0)).toBeLessThan(600);
  expect(events.filter((event) => event.type === "change")).toHaveLength(1);
  expect(events.some((event) => ["click", "submit"].includes(event.type))).toBe(false);
  expect(
    await page.evaluate((value) => window.guide.execute(value), action("clear", target)),
  ).toMatchObject({ success: true });
  expect(await page.locator("#name").inputValue()).toBe("");
});

test("AC6 refuses every action on a non-allowlisted origin", async ({ page }) => {
  await start(page, "plain", { allowlist: [] });
  const target: Target = { kind: "dom", handle: "field-handle", url: page.url() };
  for (const kind of [
    "point",
    "highlight",
    "clear",
    "caption",
    "annotate",
    "openResource",
  ] as const) {
    expect(
      await page.evaluate((instruction) => window.guide.execute(instruction), action(kind, target)),
    ).toMatchObject({ success: false, failureReason: "origin-not-allowed" });
  }
  expect(
    await page.evaluate((value) => window.guide.execute(value), typing(target, "Approved value")),
  ).toMatchObject({ success: false, failureReason: "origin-not-allowed" });
  expect(await page.locator("#name").inputValue()).toBe("Previous");
  expect(await page.evaluate(() => window.observed)).toEqual([]);
  await expect(page.locator("[data-lotse-guide]")).toHaveCount(0);
});

async function targetFor(page: Page, label: string): Promise<Target> {
  return page.evaluate((name) => {
    const snapshot = window.guide.snapshot();
    const field = snapshot.handles.find((entry) => entry.label === name);
    if (!field) throw new Error(`Missing field: ${name}`);
    return { kind: "dom", handle: field.handle, url: snapshot.url };
  }, label);
}

function action(
  kind: "point" | "highlight" | "clear" | "caption" | "annotate" | "openResource",
  target: Target,
): Action {
  return { id: "display-action", kind, target, payload: {}, sentenceIndex: 0 };
}

for (const fixture of ["plain", "controlled", "portal", "hostile"]) {
  test(`AC1 ${fixture} snapshot validates and preserves handles after unrelated insertion`, async ({
    page,
  }) => {
    await start(page, fixture);
    const first = await page.evaluate(() => window.guide.snapshot());
    expect(await page.evaluate(() => window.capsuleIsValid())).toBe(true);
    expect(await page.evaluate(() => window.guide.snapshot())).toEqual(first);
    const capsule = await page.evaluate(() => window.capsulePage());
    expect(capsule.handles.map((entry) => entry.id)).toEqual(
      first.handles
        .filter((entry) => entry.visible && !entry.credential)
        .map((entry) => entry.handle),
    );
    expect(capsule.handles.every((entry) => !("visible" in entry))).toBe(true);
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.setAttribute("aria-label", "Unrelated field");
      document.querySelector("form")?.prepend(input);
    });
    const next = await page.evaluate(() => window.guide.snapshot());
    for (const original of first.handles)
      expect(next.handles.find((entry) => entry.handle === original.handle)?.label).toBe(
        original.label,
      );
    const hidden = first.handles.filter((entry) => entry.label.startsWith("Hidden"));
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((entry) => !entry.visible)).toBe(true);
    if (fixture === "plain") {
      expect(hidden).toHaveLength(3);
      expect(first.handles.find((entry) => entry.label === "Password")?.value).toBe("");
      expect(first.handles.map((entry) => entry.label)).toContain("Preferred address");
      expect(first.handles.map((entry) => entry.label)).toContain("Postal code");
      expect(first.handles.map((entry) => entry.label)).toContain("Reference number");
    }
  });
}

function typing(target: Target, value: string, pace = 40): Action {
  return {
    id: "typing",
    kind: "type",
    target,
    sentenceIndex: 0,
    payload: { value, pace, provenance: { source: { kind: "statement" } } },
  };
}

test("AC3 controlled input observes every native-setter character and updates its state", async ({
  page,
}) => {
  await start(page, "controlled");
  const target = await targetFor(page, "Controlled name");
  expect(
    await page.evaluate((value) => window.guide.execute(value), typing(target, "Alex")),
  ).toMatchObject({ success: true });
  await expect(page.locator("#controlled")).toHaveValue("Alex");
  await expect(page.locator("#state")).toHaveText("Alex");
  const events = await page.evaluate(() => window.observed);
  const inputs = events.filter((event) => event.type === "input");
  expect(inputs.map((event) => event.value)).toEqual(["A", "Al", "Ale", "Alex"]);
  for (const type of ["keydown", "keyup"])
    expect(events.filter((event) => event.type === type).map((event) => event.key)).toEqual([
      "A",
      "l",
      "e",
      "x",
    ]);
  expect(events.filter((event) => event.type === "beforeinput").map((event) => event.data)).toEqual(
    ["A", "l", "e", "x"],
  );
  for (let index = 1; index < inputs.length; index++)
    expect((inputs[index]?.time ?? 0) - (inputs[index - 1]?.time ?? 0)).toBeGreaterThanOrEqual(34);
  expect((inputs.at(-1)?.time ?? 0) - (inputs[0]?.time ?? 0)).toBeLessThan(600);
  expect(events.filter((event) => event.type === "change")).toHaveLength(1);
  expect(events.some((event) => ["click", "submit"].includes(event.type))).toBe(false);
  expect(
    await page.evaluate((value) => window.guide.execute(value), action("clear", target)),
  ).toMatchObject({ success: true });
  await expect(page.locator("#controlled")).toHaveValue("");
  await expect(page.locator("#state")).toBeEmpty();
});

test("AC4 every German and English denied fixture control refuses all actions", async ({
  page,
}) => {
  await start(page, "portal", { denyList: { roles: [], inputTypes: [], labelPatterns: [] } });
  const targets = await page.evaluate(() => {
    const snapshot = window.guide.snapshot();
    const controls = Array.from(document.querySelectorAll("input,button,a,[role]"));
    if (controls.length !== snapshot.handles.length)
      throw new Error("Fixture snapshot omits a control");
    return controls.flatMap((control, index) => {
      if (!control.hasAttribute("data-denied")) return [];
      const entry = snapshot.handles[index];
      if (!entry?.visible) throw new Error("Denied fixture control must be visible");
      return [{ kind: "dom" as const, handle: entry.handle, url: snapshot.url }];
    });
  });
  expect(targets).toHaveLength(await page.locator("[data-denied]").count());
  expect(targets.length).toBeGreaterThan(20);
  const before = await page
    .locator("input")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
  for (const target of targets) {
    for (const instruction of [
      ...(["point", "highlight", "annotate", "caption", "clear"] as const).map((kind) =>
        action(kind, target),
      ),
      typing(target, "Approved value"),
    ]) {
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject({ success: false, failureReason: "denied" });
    }
  }
  expect(
    await page
      .locator("input")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value)),
  ).toEqual(before);
  expect(await page.evaluate(() => window.observed)).toEqual([]);
  await expect(page.locator("[data-lotse-guide]")).toHaveCount(0);
});

test("L1 ghost preview displays approved text without changing or focusing the field", async ({
  page,
}) => {
  await start(page, "plain", { ghostPreview: true });
  const target = await targetFor(page, "Full name");
  expect(
    await page.evaluate((value) => window.guide.execute(value), typing(target, "Alex")),
  ).toMatchObject({ success: true });
  const ghost = (await inspectOverlay(page)).find((part) => part.part === "ghost");
  expect(ghost?.text).toBe("Alex");
  expect(ghost?.width).toBeGreaterThan(0);
  await expect(page.locator("#name")).toHaveValue("Previous");
  expect(await page.evaluate(() => window.observed)).toEqual([]);
  await page.evaluate(() => window.guide.dispose());
  await expect(page.locator("[data-lotse-guide]")).toHaveCount(0);
  expect(
    await page.evaluate((value) => window.guide.execute(value), typing(target, "Alex")),
  ).toMatchObject({ success: false, failureReason: "disposed" });
});

test("target resolution refreshes replaced nodes and refuses missing or ambiguous quotes", async ({
  page,
}) => {
  await start(page);
  const target = await targetFor(page, "Full name");
  await page.locator("#name").evaluate((node) => node.replaceWith(node.cloneNode(true)));
  expect(
    await page.evaluate((value) => window.guide.execute(value), action("highlight", target)),
  ).toMatchObject({ success: true });
  await page.locator("#name").evaluate((node) => node.remove());
  expect(
    await page.evaluate((value) => window.guide.execute(value), action("point", target)),
  ).toMatchObject({ success: false, failureReason: "target-not-found" });
  for (const quote of ["Missing quote.", "bring the completed form to the office."]) {
    expect(
      await page.evaluate(
        (value) => window.guide.execute(value),
        action("highlight", { kind: "text", quote }),
      ),
    ).toMatchObject({ success: false, failureReason: "target-not-found" });
  }
  await page.locator("#quote").evaluate((node) => node.after(node.cloneNode(true)));
  expect(
    await page.evaluate(
      (value) => window.guide.execute(value),
      action("highlight", { kind: "text", quote: "Bring the completed form to the office." }),
    ),
  ).toMatchObject({ success: false, failureReason: "target-not-found" });
});

test("AC1 and AC4 credential autocomplete tokens never enter capsules or accept edits", async ({
  page,
}) => {
  await start(page, "plain", { denyList: { roles: [], inputTypes: [], labelPatterns: [] } });
  for (const autocomplete of [
    "one-time-code",
    "section-login ONE-TIME-CODE",
    "current-password",
    "new-password",
    "username webauthn",
  ]) {
    await page.evaluate((token) => {
      const input = document.createElement("input");
      input.id = "credential";
      input.setAttribute("autocomplete", token);
      input.setAttribute("aria-label", "Credential");
      input.value = "Fixture credential";
      document.querySelector("form")?.prepend(input);
    }, autocomplete);
    const target = await targetFor(page, "Credential");
    const snapshot = await page.evaluate(() => window.guide.snapshot());
    expect(snapshot.handles.find((entry) => entry.label === "Credential")?.value).toBe("");
    const capsule = await page.evaluate(() => window.capsulePage());
    expect(capsule.handles.some((entry) => entry.label === "Credential")).toBe(false);
    expect(capsule.handles.some((entry) => entry.label === "Password")).toBe(false);
    for (const instruction of [typing(target, "Approved value"), action("clear", target)])
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject({ success: false, failureReason: "denied" });
    await expect(page.locator("#credential")).toHaveValue("Fixture credential");
    await page.locator("#credential").evaluate((node) => node.remove());
  }
  expect(await page.evaluate(() => window.observed)).toEqual([]);
  await expect(page.locator("[data-lotse-guide]")).toHaveCount(0);
});

for (const mutation of ["replace-both", "delete-first", "delete-then-replace"] as const) {
  test(`AC1 retires ambiguous repeated-row handles after ${mutation}`, async ({ page }) => {
    await start(page);
    const targets = await page.evaluate(() => {
      const rows = document.createElement("div");
      rows.id = "rows";
      rows.style.cssText = "position:fixed;top:0;left:0";
      rows.innerHTML =
        '<label>Name<input value="First"></label><label>Name<input value="Second"></label>';
      document.body.append(rows);
      const snapshot = window.guide.snapshot();
      return snapshot.handles
        .filter((entry) => entry.label === "Name")
        .map((entry) => ({ kind: "dom" as const, handle: entry.handle, url: snapshot.url }));
    });
    const first = targets[0];
    const second = targets[1];
    if (!first || !second) throw new Error("Missing repeated-row targets");
    await page.evaluate((kind) => {
      const rows = document.querySelector("#rows");
      const remaining = rows?.lastElementChild;
      if (!rows || !remaining) throw new Error("Missing repeated rows");
      if (kind === "replace-both") rows.replaceChildren(remaining.cloneNode(true));
      else {
        rows.firstElementChild?.remove();
        window.guide.snapshot();
        if (kind === "delete-then-replace") remaining.replaceWith(remaining.cloneNode(true));
      }
    }, mutation);
    for (const target of mutation === "delete-first" ? [first] : [first, second])
      for (const instruction of [typing(target, "Approved value"), action("clear", target)])
        expect(
          await page.evaluate((value) => window.guide.execute(value), instruction),
        ).toMatchObject({ success: false, failureReason: "target-not-found" });
    await expect(page.locator("#rows input")).toHaveValue("Second");
    if (mutation === "delete-first")
      expect(
        await page.evaluate((value) => window.guide.execute(value), action("highlight", second)),
      ).toMatchObject({ success: true });
    expect(await page.evaluate(() => window.observed)).toEqual([]);
  });
}

test("AC1 and AC3 completely clipped fields and quotes cannot be captured or edited", async ({
  page,
}) => {
  await start(page);
  const target = await targetFor(page, "Fully clipped field");
  const bounds = await page.getByLabel("Fully clipped field").boundingBox();
  expect(bounds?.x).toBeGreaterThan(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThan(1000);
  expect(bounds?.y).toBeGreaterThan(0);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThan(800);
  const snapshot = await page.evaluate(() => window.guide.snapshot());
  expect(snapshot.handles.find((entry) => entry.label === "Fully clipped field")?.visible).toBe(
    false,
  );
  expect(
    await page.evaluate(() =>
      window.capsulePage().handles.some((entry) => entry.label === "Fully clipped field"),
    ),
  ).toBe(false);
  for (const instruction of [
    typing(target, "Approved value"),
    action("clear", target),
    action("highlight", target),
    action("highlight", { kind: "text", quote: "Fully clipped quote." }),
  ])
    expect(await page.evaluate((value) => window.guide.execute(value), instruction)).toMatchObject({
      success: false,
      failureReason: "target-not-found",
    });
  await expect(page.getByLabel("Fully clipped field")).toHaveValue("Unchanged");
  expect(await page.evaluate(() => window.observed)).toEqual([]);
  await expect(page.locator("[data-lotse-guide]")).toHaveCount(0);
});

for (const event of ["blur", "change"] as const) {
  for (const kind of ["type", "clear"] as const) {
    test(`AC3 reports value-changed when ${event} rejects ${kind}`, async ({ page }) => {
      await start(page);
      const target = await targetFor(page, "Full name");
      await page.locator("#name").evaluate((node: HTMLInputElement, type) => {
        node.addEventListener(type, () => {
          node.value = "Portal replacement";
        });
      }, event);
      const instruction = kind === "type" ? typing(target, "Alex") : action("clear", target);
      expect(
        await page.evaluate((value) => window.guide.execute(value), instruction),
      ).toMatchObject({ success: false, failureReason: "value-changed" });
      await expect(page.locator("#name")).toHaveValue("Portal replacement");
      const events = await page.evaluate(() => window.observed);
      expect(events.filter((entry) => entry.type === "change")).toHaveLength(1);
      expect(events.filter((entry) => entry.type === "blur")).toHaveLength(1);
    });
  }
}

test("AC1 replacement requires a stable structural anchor even for a unique label", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Unanchored name");
    input.value = "Unchanged";
    document.body.prepend(input);
  });
  const target = await targetFor(page, "Unanchored name");
  await page
    .getByLabel("Unanchored name")
    .evaluate((node) => node.replaceWith(node.cloneNode(true)));
  for (const instruction of [typing(target, "Approved value"), action("clear", target)])
    expect(await page.evaluate((value) => window.guide.execute(value), instruction)).toMatchObject({
      success: false,
      failureReason: "target-not-found",
    });
  await expect(page.getByLabel("Unanchored name")).toHaveValue("Unchanged");
});

test("AC1 retires a rebound handle if its original node returns alongside its replacement", async ({
  page,
}) => {
  await start(page);
  await page.locator("#name").evaluate((node) => node.setAttribute("aria-label", "Full name"));
  const target = await targetFor(page, "Full name");
  await page.locator("#name").evaluate((node) => {
    node.replaceWith(node.cloneNode(true));
    window.guide.snapshot();
    document.querySelector("form")?.prepend(node);
  });
  for (const instruction of [typing(target, "Approved value"), action("clear", target)])
    expect(await page.evaluate((value) => window.guide.execute(value), instruction)).toMatchObject({
      success: false,
      failureReason: "target-not-found",
    });
  const snapshot = await page.evaluate(() => window.guide.snapshot());
  const handles = snapshot.handles.filter((entry) => entry.label === "Full name");
  expect(handles).toHaveLength(2);
  expect(new Set(handles.map((entry) => entry.handle)).size).toBe(2);
  expect(
    await page
      .locator("input#name")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value)),
  ).toEqual(["Previous", "Previous"]);
});

test("AC3 clipping during typing prevents further character entry", async ({ page }) => {
  await start(page);
  const target = await targetFor(page, "Full name");
  await page.locator("#name").evaluate((node: HTMLInputElement) => {
    const container = document.createElement("div");
    container.style.cssText = "width:300px;overflow:hidden";
    node.before(container);
    container.append(node);
    node.value = "";
    node.addEventListener(
      "input",
      () => {
        node.style.marginLeft = "400px";
      },
      { once: true },
    );
    window.observed = [];
  });
  expect(
    await page.evaluate((value) => window.guide.execute(value), typing(target, "Alex")),
  ).toMatchObject({
    success: false,
    failureReason: "target-not-found",
  });
  await expect(page.locator("#name")).toHaveValue("A");
  expect(
    await page.evaluate(() =>
      window.observed.filter((event) => event.type === "input").map((event) => event.value),
    ),
  ).toEqual(["A"]);
});

for (const method of ["clear", "dispose"] as const) {
  test(`AC5 ${method} during reduced-motion pointing leaves no overlay`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await start(page);
    const instruction = action("point", await targetFor(page, "Full name"));
    instruction.payload = { label: "Approved field" };
    expect(
      await page.evaluate(
        async ({ value, method }) => {
          const pending = window.guide.execute(value);
          window.guide[method]();
          return pending;
        },
        { value: instruction, method },
      ),
    ).toMatchObject({ success: false, failureReason: "interrupted" });
    await expect(page.locator("[data-lotse-guide]")).toHaveCount(0);
  });
}
