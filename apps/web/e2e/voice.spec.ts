import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Browser capabilities and provider outage are isolated test doubles only.
  await page.addInitScript(() => {
    class Recognition {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult:
        | ((event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void)
        | undefined;
      onend: (() => void) | undefined;
      start(): void {
        this.onresult?.({ results: [{ isFinal: true, 0: { transcript: "Where is the form?" } }] });
      }
      stop(): void {
        this.onend?.();
      }
      abort(): void {}
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Recognition });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: () => undefined,
        speak: (utterance: SpeechSynthesisUtterance) => {
          queueMicrotask(() => {
            utterance.dispatchEvent(new Event("start"));
            utterance.dispatchEvent(new Event("end"));
          });
        },
      },
    });
  });
  await page.route("**/api/voice/token", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "VOICE_UNAVAILABLE" }),
    }),
  );
});

test("@voice keyboard push-to-talk sends one transcript and reads a text-only answer with browser fallback", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/turn", async (route) => {
    requests++;
    const body: unknown = route.request().postDataJSON();
    expect(body).toMatchObject({
      inputKind: "transcript",
      message: { role: "user", parts: [{ type: "text", text: "Where is the form?" }] },
    });
    const parts = [
      { type: "start", messageId: "test-answer" },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "Here is the form." },
      { type: "text-end", id: "text" },
      { type: "finish" },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: `${parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("")}data: [DONE]\n\n`,
    });
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Zum Sprechen gedrückt halten" });
  await button.focus();
  await page.keyboard.down("Space");
  await expect(page.getByRole("button", { name: "Ich höre zu …" })).toBeVisible();
  expect(requests).toBe(0);
  await page.keyboard.up("Space");
  await expect(page.locator("ol")).toContainText("Here is the form.");
  await expect(page.locator('p[aria-live="polite"]').last()).toHaveText("Here is the form.");
  expect(requests).toBe(1);
});

test("@voice sentence playback executes a real workspace highlight and keeps WCAG 2.2 AA controls", async ({
  page,
}) => {
  await page.route("**/api/turn", async (route) => {
    // Construct a protocol fixture from a real guide snapshot, never a product target constant.
    const body = route.request().postDataJSON() as {
      capsule: { page: { url: string; handles: { id: string; role: string }[] } };
    };
    const target = body.capsule.page.handles.find((handle) => handle.role === "textbox");
    expect(target).toBeDefined();
    const parts = [
      { type: "start", messageId: "test-answer" },
      {
        type: "data-action",
        data: {
          id: "test-action",
          kind: "highlight",
          sentenceIndex: 0,
          target: { kind: "dom", handle: target?.id, url: body.capsule.page.url },
          payload: {},
        },
      },
      {
        type: "data-speech-segment",
        data: {
          turnId: "test-turn",
          index: 0,
          text: "Hier ist das Textfeld.",
          language: "de",
          citations: [],
          actionIds: ["test-action"],
        },
      },
      { type: "finish" },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: `${parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("")}data: [DONE]\n\n`,
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Ihre Nachricht" }).fill("Wo ist das Textfeld?");
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(page.locator("[data-lotse-guide]")).toBeVisible();
  await expect(page.locator('p[aria-live="polite"]').last()).toHaveText("Hier ist das Textfeld.");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
