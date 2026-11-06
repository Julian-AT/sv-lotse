import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { bundleConfig } from "../../build/config.ts";
import type * as injection from "../../build/entry.ts";
import { inspectOverlay } from "../inspect-overlay.ts";

declare global {
  interface Window {
    __lotseGuide: typeof injection;
  }
}

const fixtureUrl = "https://guide.test/fixture.html";
const fixture = await readFile(new URL("./fixture.html", import.meta.url), "utf8");

for (const mode of ["script tag", "document start"] as const) {
  test(`AC2 ${mode} injection snapshots and points through the global without network access`, async ({
    page,
  }) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    page.on("websocket", (socket) => requests.push(socket.url()));
    // Only the local HTML fixture is served. No source modules or provider is served.
    await page.route("**/*", (route) =>
      route.request().url() === fixtureUrl
        ? route.fulfill({ contentType: "text/html", body: fixture })
        : route.abort(),
    );
    if (mode === "document start") await page.addInitScript({ path: bundleConfig.outfile });
    await page.goto(fixtureUrl);
    await page.context().setOffline(true);
    if (mode === "script tag") await page.addScriptTag({ path: bundleConfig.outfile });

    const observed = await page.evaluate(async () => {
      const guide = window.__lotseGuide.createGuide({ allowlist: [location.origin] });
      const snapshot = guide.snapshot();
      const field = snapshot.handles.find((entry) => entry.label === "Referenz");
      if (!field) throw new Error("Missing fixture handle");
      const result = await guide.execute({
        id: "bundle-point",
        kind: "point",
        target: { kind: "dom", handle: field.handle, url: snapshot.url },
        payload: { label: "Referenz" },
        sentenceIndex: 0,
      });
      return { snapshot, field, result, exports: Object.keys(window.__lotseGuide) };
    });

    expect(observed.exports).toEqual(["createGuide"]);
    expect(observed.snapshot.url).toBe(fixtureUrl);
    expect(observed.field).toMatchObject({
      role: "textbox",
      label: "Referenz",
      value: "Unverändert",
      visible: true,
      credential: false,
    });
    expect(observed.result).toEqual({
      actionId: "bundle-point",
      success: true,
      resolvedBy: "dom",
      confidence: 1,
    });
    // Snapshot boxes are normalized; debugger overlay geometry is in CSS pixels.
    const fieldBox = await page.locator("#reference").boundingBox();
    expect(fieldBox).toBeDefined();
    if (!fieldBox) throw new Error("Missing fixture field geometry");
    const parts = await inspectOverlay(page);
    const cursor = parts.find((part) => part.part === "cursor");
    expect(cursor).toBeDefined();
    expect(Math.abs((cursor?.x ?? -1) - (fieldBox.x + fieldBox.width / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs((cursor?.y ?? -1) - (fieldBox.y + fieldBox.height / 2))).toBeLessThanOrEqual(2);
    expect(parts.find((part) => part.part === "annotation")?.text).toBe("Referenz");
    await expect(page.locator("#reference")).toHaveValue("Unverändert");
    expect(errors).toEqual([]);
    expect(requests).toEqual([fixtureUrl]);
  });
}
