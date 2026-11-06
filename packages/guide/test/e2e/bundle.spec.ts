import { stat } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../../src/inject.ts";
import type { PortalField, PortalPage, PortalRequest } from "../../src/portal-contract.ts";
import type {} from "../portal-workspace.ts";

async function start(page: Page): Promise<Page> {
  await page.goto("/plain.html");
  const popupPromise = page.waitForEvent("popup");
  await page.addScriptTag({ type: "module", content: 'import "/test/portal-workspace.ts";' });
  const popup = await popupPromise;
  await popup.waitForLoadState();
  const code = await page.evaluate(() => window.portalBookmark);
  // Execute the actual user-activated bookmark, including loading the served IIFE.
  await popup.evaluate((value) => {
    location.href = value;
  }, code);
  await expect
    .poll(() => page.evaluate(() => window.portalReplies.some((reply) => reply.kind === "ready")))
    .toBe(true);
  return popup;
}

async function send(page: Page, command: PortalRequest): Promise<void> {
  await page.evaluate(
    (input) =>
      window.sendPortal({
        ...input,
        channel: window.portalConnection.channel,
        id: crypto.randomUUID(),
      }),
    command,
  );
}

async function snapshot(page: Page): Promise<PortalPage> {
  const before = await page.evaluate(
    () => window.portalReplies.filter((reply) => reply.kind === "snapshot").length,
  );
  await send(page, { kind: "snapshot" });
  await expect
    .poll(() =>
      page.evaluate(() => window.portalReplies.filter((reply) => reply.kind === "snapshot").length),
    )
    .toBeGreaterThan(before);
  const result = await page.evaluate(
    () => window.portalReplies.findLast((reply) => reply.kind === "snapshot")?.page,
  );
  if (!result) throw new Error("Snapshot missing");
  return result;
}

function field(page: PortalPage, label: string, value: string): PortalField {
  const handle = page.handles.find((handle) => handle.label === label);
  if (!handle) throw new Error("Fixture field missing");
  return { handle: handle.id, label, value };
}

test("FR-D7 IIFE loads without modules and exposes the guide under its size budget", async ({
  page,
}) => {
  expect(
    (await stat(new URL("../../dist-bundle/guide.iife.js", import.meta.url))).size,
  ).toBeLessThan(512 * 1024);
  await page.goto("/plain.html");
  await page.addScriptTag({ url: "/dist-bundle/guide.iife.js" });
  expect(await page.evaluate(() => typeof window.__lotseGuide.createGuide)).toBe("function");
  expect(
    await page.evaluate(() =>
      window.__lotseGuide
        .toCapsulePage(window.__lotseGuide.createGuide({ allowlist: [location.origin] }).snapshot())
        .handles.some((handle) => handle.label === "Full name"),
    ),
  ).toBe(true);
});

test("FR-D7 cross-origin portal snapshots, points and visibly types the reviewed values without submission", async ({
  page,
}) => {
  const popup = await start(page);
  const captured = await snapshot(page);
  expect(captured.handles.some((handle) => handle.label === "Password")).toBe(false);
  // Activating the bookmark twice must not install duplicate typing listeners.
  const bookmark = await page.evaluate(() => window.portalBookmark);
  await popup.evaluate((value) => {
    location.href = value;
  }, bookmark);
  const name = field(captured, "Full name", "Ada");
  await send(page, { kind: "point", url: captured.url, handle: name.handle });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.portalReplies.some((reply) => reply.kind === "result" && reply.success),
      ),
    )
    .toBe(true);
  expect(await popup.locator("#name").inputValue()).toBe("Previous");
  await send(page, { kind: "fill", url: captured.url, approved: true, fields: [name] });
  await expect(popup.locator("#name")).toHaveValue("Ada");
  await expect
    .poll(() => popup.evaluate(() => window.observed.some((event) => event.type === "blur")))
    .toBe(true);
  const observed = await popup.evaluate(() => window.observed);
  expect(observed.filter((event) => event.type === "input").map((event) => event.value)).toEqual([
    "",
    "A",
    "Ad",
    "Ada",
  ]);
  const timed = observed.filter((event) => event.type === "input" && event.value);
  expect((timed[1]?.time ?? 0) - (timed[0]?.time ?? 0)).toBeGreaterThanOrEqual(40);
  expect(observed.some((event) => ["click", "submit"].includes(event.type))).toBe(false);
});

test("FR-D7 rejects denial, stale reviews, unapproved values and forged source windows", async ({
  page,
}) => {
  const popup = await start(page);
  const captured = await snapshot(page);
  const name = field(captured, "Full name", "Must not type");
  const forged = {
    kind: "fill",
    url: captured.url,
    approved: true,
    fields: [name],
    channel: await page.evaluate(() => window.portalConnection.channel),
    id: crypto.randomUUID(),
  };
  // Even a synthetic message with the correct origin/channel has the wrong source.
  await popup.evaluate(
    (data) =>
      window.dispatchEvent(
        new MessageEvent("message", { origin: "http://127.0.0.1:4178", data, source: window }),
      ),
    forged,
  );
  await page.evaluate((data) => {
    const { approved: _approved, ...unapproved } = data;
    window.portalPopup.postMessage(unapproved, window.portalConnection.portalOrigin);
  }, forged);
  await send(page, {
    kind: "fill",
    approved: true,
    url: `${captured.url}?changed`,
    fields: [name],
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.portalReplies.some((reply) => reply.kind === "result" && !reply.success),
      ),
    )
    .toBe(true);
  await popup
    .locator("#postal")
    .evaluate((element) => element.setAttribute("aria-label", "Absenden"));
  const deniedHandle = await popup.evaluate(() =>
    window.__lotseGuide
      .createGuide({ allowlist: [location.origin] })
      .snapshot()
      .handles.find((handle) => handle.label === "Absenden"),
  );
  if (!deniedHandle) throw new Error("Denied fixture missing");
  const before = await page.evaluate(() => window.portalReplies.length);
  await send(page, {
    kind: "fill",
    approved: true,
    url: captured.url,
    fields: [name, { handle: deniedHandle.handle, label: "Absenden", value: "never" }],
  });
  await expect.poll(() => page.evaluate(() => window.portalReplies.length)).toBeGreaterThan(before);
  expect(await popup.locator("#name").inputValue()).toBe("Previous");
  expect(await popup.locator("#postal").inputValue()).toBe("");
});

test("FR-D7 stopping a group prevents later fields and leaves partial input visible", async ({
  page,
}) => {
  const popup = await start(page);
  const captured = await snapshot(page);
  await send(page, {
    kind: "fill",
    approved: true,
    url: captured.url,
    fields: [
      field(captured, "Full name", "A sufficiently long approved value"),
      field(captured, "Postal code", "1234"),
    ],
  });
  await expect.poll(() => popup.locator("#name").inputValue()).toMatch(/^A/);
  await send(page, { kind: "clear" });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.portalReplies.some((reply) => reply.kind === "result" && !reply.success),
      ),
    )
    .toBe(true);
  expect(await popup.locator("#name").inputValue()).not.toBe("A sufficiently long approved value");
  expect(await popup.locator("#postal").inputValue()).toBe("");
});

test("FR-D7 reconnects after portal navigation with a fresh snapshot", async ({ page }) => {
  const popup = await start(page);
  await snapshot(page);
  await popup.goto("http://localhost:4178/controlled.html");
  const bookmark = await page.evaluate(() => window.portalBookmark);
  await popup.evaluate((value) => {
    location.href = value;
  }, bookmark);
  await expect
    .poll(() =>
      page.evaluate(() => window.portalReplies.filter((reply) => reply.kind === "ready").length),
    )
    .toBe(2);
  expect((await snapshot(page)).url).toBe("http://localhost:4178/controlled.html");
});
