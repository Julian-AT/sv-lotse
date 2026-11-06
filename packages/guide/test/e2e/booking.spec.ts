import type { Target, ToolInvocation } from "@lotse/protocol";
import { expect, type Page, test } from "@playwright/test";
import type {} from "../browser.ts";

async function start(
  page: Page,
  level: "L1" | "L2" | "L3" = "L3",
  allowPage = true,
): Promise<void> {
  await page.goto("/plain.html");
  await page.evaluate(
    ({ level, allowPage }) => {
      window.guideOptions = {
        autonomyLevel: level,
        bookingPages: allowPage ? [location.href] : [],
      };
    },
    { level, allowPage },
  );
  await page.addScriptTag({ type: "module", content: 'import "/test/browser.ts";' });
  await page.waitForFunction(() => Boolean(window.guide));
}

type DomTarget = Extract<Target, { kind: "dom" }>;
async function targetFor(page: Page, label: string): Promise<DomTarget> {
  return page.evaluate((label) => {
    const snapshot = window.guide.snapshot();
    const handle = snapshot.handles.find((entry) => entry.label === label);
    if (!handle) throw new Error("Fixture field missing");
    return { kind: "dom", handle: handle.handle, url: snapshot.url };
  }, label);
}

function invocation(target: DomTarget, toolCallId = "approved-fill") {
  return {
    toolCallId,
    toolName: "ui.fill" as const,
    input: {
      target,
      value: "Alex",
      provenance: { source: { kind: "statement" as const, quote: "Alex" } },
    },
  } satisfies ToolInvocation;
}

test("FR-O6 types an approved exact value visibly and leaves final confirmation to the user", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const final = document.createElement("button");
    final.type = "submit";
    final.textContent = "Termin bestätigen";
    document.querySelector("form")?.append(final);
  });
  const input = invocation(await targetFor(page, "Full name"));
  // The host calls this only for the server's post-consumption dispatch, never a preview.
  const result = await page.evaluate((input) => window.guide.executeApprovedFill(input), input);
  expect(result).toMatchObject({ success: true, actionId: input.toolCallId });
  await expect(page.locator("#name")).toHaveValue("Alex");
  expect(
    await page.evaluate(() =>
      window.observed.filter((event) => ["click", "submit"].includes(event.type)),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate((input) => window.guide.executeApprovedFill(input), input),
  ).toMatchObject({ success: false, failureReason: "already-dispatched" });
  const final = invocation(await targetFor(page, "Termin bestätigen"), "final-confirm");
  expect(
    await page.evaluate((input) => window.guide.executeApprovedFill(input), final),
  ).toMatchObject({ success: false, failureReason: "denied" });
});

for (const level of ["L1", "L2"] as const) {
  test(`FR-O6 refuses booking writes at ${level}`, async ({ page }) => {
    await start(page, level);
    const input = invocation(await targetFor(page, "Full name"));
    expect(
      await page.evaluate((input) => window.guide.executeApprovedFill(input), input),
    ).toMatchObject({ success: false, failureReason: "autonomy-denied" });
    await expect(page.locator("#name")).toHaveValue("Previous");
  });
}

test("FR-O6 rejects an unverified booking page even on an allowed origin", async ({ page }) => {
  await start(page, "L3", false);
  const input = invocation(await targetFor(page, "Full name"));
  expect(
    await page.evaluate((input) => window.guide.executeApprovedFill(input), input),
  ).toMatchObject({ success: false, failureReason: "booking-page-not-allowed" });
  await expect(page.locator("#name")).toHaveValue("Previous");
  expect(
    await page.evaluate(
      (input) =>
        window.guide.execute({
          id: "unverified-display",
          kind: "type",
          target: input.input.target,
          sentenceIndex: 0,
          payload: { value: input.input.value, provenance: input.input.provenance, pace: 1 },
        }),
      input,
    ),
  ).toMatchObject({ success: false, failureReason: "approval-required" });
  await expect(page.locator("#name")).toHaveValue("Previous");
});

test("FR-O6 refuses an unapproved display action on a configured booking page", async ({
  page,
}) => {
  await start(page);
  const target = await targetFor(page, "Full name");
  expect(
    await page.evaluate(
      (target) =>
        window.guide.execute({
          id: "unapproved",
          kind: "type",
          target,
          sentenceIndex: 0,
          payload: {
            value: "Alex",
            pace: 1,
            provenance: { source: { kind: "statement", quote: "Alex" } },
          },
        }),
      target,
    ),
  ).toMatchObject({ success: false, failureReason: "approval-required" });
  await expect(page.locator("#name")).toHaveValue("Previous");
});
