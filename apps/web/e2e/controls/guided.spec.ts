import { expect, test } from "./fixtures.ts";

test("guided portal blocks untrusted addresses, opens an official portal, exposes the activation code and disconnects", async ({
  page,
  context,
}) => {
  await page.goto("/guided?lang=en");
  await expect(
    page.getByRole("button", { name: "Capture visible fields", exact: true }),
  ).toBeDisabled();
  const address = page.getByLabel("Portal address", { exact: true });
  const official = await address.inputValue();
  await address.fill("https://not-allowlisted.example/form");
  await page.getByRole("button", { name: "Open portal in a new window", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Connection unavailable");
  expect(context.pages()).toHaveLength(1);
  await address.fill(official);
  const popupEvent = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open portal in a new window", exact: true }).click();
  const popup = await popupEvent;
  const details = page.locator("main details");
  await details.locator("summary").click();
  await expect(details.getByRole("textbox")).toHaveValue(/^javascript:/);
  await details.getByRole("textbox").focus();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeDisabled();
  await expect(details).toHaveCount(0);
  await popup.close();
});
