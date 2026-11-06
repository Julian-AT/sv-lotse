import { randomUUID } from "node:crypto";
import { database, expect, test } from "./fixtures.ts";

test("workspace creates and switches real cases, restores history and sends a live administrative turn", async ({
  page,
  auditCase,
}) => {
  const message = {
    id: randomUUID(),
    role: "assistant",
    parts: [{ type: "text", text: "Wir können die Verwaltungsunterlagen gemeinsam prüfen." }],
  };
  await database.sql`INSERT INTO message (case_id, position, ui_message) VALUES (${auditCase.id}, 0, ${JSON.stringify(message)}::jsonb)`;
  await page.goto("/workspace");
  await expect(
    page.getByText("Wir können die Verwaltungsunterlagen gemeinsam prüfen.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Neues Anliegen", exact: true }).click();
  await expect(page.locator("#workspace-message")).toBeVisible();
  const selector = page.getByRole("combobox", { name: "Ihr Anliegen", exact: true });
  await expect(selector.locator("option")).toHaveCount(3);
  await expect(selector).toBeEnabled();
  await expect(selector).not.toHaveValue("");
  const nextId = await selector.inputValue();
  expect(nextId).not.toBe(auditCase.id);
  await selector.selectOption(auditCase.id);
  await expect(selector).toBeEnabled();
  await expect(
    page.getByText("Wir können die Verwaltungsunterlagen gemeinsam prüfen.", { exact: true }),
  ).toBeVisible();
  await selector.selectOption(nextId);
  await expect(
    page.getByText("Wir können die Verwaltungsunterlagen gemeinsam prüfen.", { exact: true }),
  ).toHaveCount(0);
  const input = page.locator("#workspace-message");
  await input.fill("Bitte bestätigen Sie kurz, dass Sie bei Verwaltungsfragen helfen können.");
  const sent = page.waitForResponse(
    (response) => response.url().endsWith("/api/turn") && response.request().method() === "POST",
  );
  await input.locator("..").getByRole("button", { name: "Senden", exact: true }).click();
  expect((await sent).status()).toBe(200);
  await expect(page.locator('[data-speaker="assistant"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("alert").filter({ hasText: "Das hat nicht geklappt" })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.locator('[data-speaker="assistant"]')).toBeVisible();
});

test("workspace stop cancels a running real turn and restores the send control", async ({
  page,
  auditCase,
}) => {
  await page.goto("/workspace");
  const input = page.locator("#workspace-message");
  await input.fill("Bitte erklären Sie, wie wir gemeinsam Verwaltungsunterlagen ordnen können.");
  const request = page.waitForRequest((request) => request.url().endsWith("/api/turn"));
  await input.locator("..").getByRole("button", { name: "Senden", exact: true }).click();
  await request;
  const stop = page.getByRole("button", { name: "Antwort stoppen", exact: true });
  await stop.click();
  await expect(stop).toHaveCount(0);
  await input.fill("Weitere Frage");
  await expect(
    input.locator("..").getByRole("button", { name: "Senden", exact: true }),
  ).toBeEnabled();
  expect(auditCase.id).toBeTruthy();
});
