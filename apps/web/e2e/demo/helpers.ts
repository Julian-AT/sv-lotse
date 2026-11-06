import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { DEMO_E2E } from "./config.ts";

const historySchema = z.object({
  messages: z.array(
    z.object({
      parts: z.array(
        z.object({
          type: z.string(),
          toolName: z.string().optional(),
          state: z.string().optional(),
          output: z.unknown().optional(),
          input: z.unknown().optional(),
          errorText: z.string().optional(),
        }),
      ),
    }),
  ),
});

export async function outputs(page: Page, caseId: string, tool: string): Promise<unknown[]> {
  const response = await page.request.get(`/api/cases/messages?caseId=${caseId}`);
  expect(response.ok(), "Persisted conversation is readable").toBe(true);
  const history = historySchema.parse(await response.json());
  return history.messages
    .flatMap((message) => message.parts)
    .filter(
      (part) =>
        (part.type === `tool-${tool}` || part.toolName === tool) &&
        part.state === "output-available",
    )
    .map((part) => part.output);
}

export async function say(page: Page, text: string): Promise<void> {
  const composer = page.getByLabel("Ihre Nachricht", { exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill(text);
  const response = page.waitForResponse(
    (item) => item.url().endsWith("/api/turn") && item.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  const streamed = await response;
  expect(streamed.ok(), "The live turn starts successfully").toBe(true);
  // Read while this request still owns its browser resource, before UI-driven continuations.
  const content = await streamed.text();
  await expect(page.locator('[aria-labelledby="conversation-title"] [aria-busy]')).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: DEMO_E2E.turnTimeoutMs },
  );
  const errorEvent = z.object({
    type: z.literal("error"),
    errorText: z.string().regex(/^[A-Z_]+$/u),
  });
  const errors = content.split("\n").flatMap((line) => {
    if (!line.startsWith("data: {")) return [];
    const parsed = errorEvent.safeParse(JSON.parse(line.slice("data: ".length)));
    return parsed.success ? [parsed.data.errorText] : [];
  });
  expect(errors, "The live stream finishes without a fatal server error").toEqual([]);
  await expect(
    page.getByText("Das hat nicht geklappt. Bitte versuchen Sie es erneut.", { exact: true }),
  ).toHaveCount(0);
}

export async function requireTool(page: Page, caseId: string, tool: string): Promise<unknown> {
  try {
    await expect
      .poll(async () => (await outputs(page, caseId, tool)).length, {
        timeout: DEMO_E2E.persistenceTimeoutMs,
      })
      .toBeGreaterThan(0);
  } catch {
    const response = await page.request.get(`/api/cases/messages?caseId=${caseId}`);
    const history = historySchema.parse(await response.json());
    const states = history.messages
      .flatMap((message) => message.parts)
      .filter((part) => part.type === `tool-${tool}` || part.toolName === tool)
      .map((part) => ({
        state: part.state,
        code: /^[A-Z_]+$/u.test(part.errorText ?? "") ? part.errorText : undefined,
        referenceInput: z
          .object({ benefitId: z.string().startsWith("ref:catalog/") })
          .safeParse(part.input).success,
      }));
    const catalogSizes = history.messages
      .flatMap((message) => message.parts)
      .filter(
        (part) =>
          part.type === "tool-catalog.findBenefits" || part.toolName === "catalog.findBenefits",
      )
      .map((part) => (Array.isArray(part.output) ? part.output.length : 0));
    throw new Error(
      `${tool} has no successful result: ${JSON.stringify({ states, catalogSizes })}`,
    );
  }
  return (await outputs(page, caseId, tool)).at(-1);
}

/** Answer one actual clarification; never approve a gated tool through conversation text. */
export async function confirmSubstepIfAsked(
  page: Page,
  caseId: string,
  tool: string,
): Promise<void> {
  if ((await outputs(page, caseId, tool)).length > 0) return;
  if (!(await page.getByLabel("Ihre Nachricht", { exact: true }).isEnabled())) return;
  const reply = (await page.locator('[data-speaker="assistant"]').last().textContent()) ?? "";
  if (!/bestätig|ist das (?:ihr|dein) ziel|soll ich/iu.test(reply)) return;
  await say(
    page,
    "Ja, ich bestätige diesen Teilschritt. Er gehört zu meinem bereits bestätigten Antragsziel, das unverändert bleibt. Bitte führen Sie den angefragten Entwurfsschritt jetzt aus. Die Feldgruppenfreigabe bestätige ich anschließend über die Freigabekarte.",
  );
}
