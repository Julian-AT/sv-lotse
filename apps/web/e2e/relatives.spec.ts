import { createSubjectService } from "@lotse/brain/subjects";
import { createDatabase } from "@lotse/db";
import { caseSteps } from "@lotse/db/schema";
import { expect, test } from "@playwright/test";
import { RoomServiceClient } from "livekit-server-sdk";
import { z } from "zod";
import { relativesCopy } from "../src/features/relatives/copy.ts";

// Chromium's synthetic capture devices are the only test double.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
    ],
  },
});

const database = createDatabase();
const copy = relativesCopy.de;
test.afterAll(async () => {
  await database.close();
});

test("FR-R1–R3 approved helpers see screen and voice, point and annotate, and end the session", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(60000);
  if (!baseURL) throw new Error("TEST_BASE_URL_REQUIRED");
  const helperContext = await browser.newContext({ baseURL });
  const helperPage = await helperContext.newPage();
  const identitySchema = z.object({ userId: z.uuid(), sessionId: z.uuid() });
  await page.goto("/workspace/helpers");
  const identity = identitySchema.parse(await (await context.request.post("/api/session")).json());
  const subjects = createSubjectService(database, identity.userId);
  const subject = await subjects.createSubject({
    displayName: "Testperson",
    relationToUser: "self",
  });
  try {
    const result = await subjects.createCase({
      subjectId: subject.id,
      confirmedGoal: "Antrag gemeinsam vorbereiten",
    });
    await page.reload();
    const inviteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/relatives/invites") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: copy.invite, exact: true }).click();
    const createdInvite = await inviteResponse;
    expect(createdInvite.status()).toBe(200);
    const link = await page.getByLabel(copy.link).inputValue();
    const token = new URL(link).hash.slice(1);
    // Only the fragment carries the bearer invitation, so the server never logs it as a URL.
    expect(new URL(link).search).toBe("");
    await helperPage.goto(link);
    await helperPage.getByRole("button", { name: copy.join, exact: true }).click();
    await expect(helperPage.getByText(copy.approval, { exact: true })).toBeVisible();
    const [pending] =
      await database.sql`SELECT r.id FROM relative_session r JOIN helper_invite i ON i.id = r.invite_id WHERE i.case_id = ${result.case.id}`;
    const sessionId = z.uuid().parse(pending?.id);
    expect(
      (
        await helperContext.request.post("/api/relatives/token", { data: { id: sessionId } })
      ).status(),
    ).toBe(403);
    expect(
      (
        await helperContext.request.post("/api/relatives/session", {
          data: { id: sessionId, action: "approve" },
        })
      ).status(),
    ).toBe(403);
    const uninvited = await browser.newContext({ baseURL });
    try {
      await uninvited.newPage().then((otherPage) => otherPage.goto("/helper"));
      expect(
        (await uninvited.request.post("/api/relatives/join", { data: { token } })).status(),
      ).toBe(403);
    } finally {
      await uninvited.close();
    }
    await page.getByRole("button", { name: copy.approve, exact: true }).click();
    await page.getByRole("button", { name: copy.connect, exact: true }).click();
    await helperPage.getByRole("button", { name: copy.helperConnect, exact: true }).click();
    await expect(page.getByText(copy.active, { exact: true })).toBeVisible();
    await expect(helperPage.getByText(copy.active, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.microphone, exact: true }).click();
    await helperPage.getByRole("button", { name: copy.microphone, exact: true }).click();
    await expect(page.getByRole("button", { name: copy.mute, exact: true })).toBeVisible();
    await expect(helperPage.getByRole("button", { name: copy.mute, exact: true })).toBeVisible();
    await expect.poll(() => page.locator("audio").count()).toBeGreaterThan(0);
    await expect.poll(() => helperPage.locator("audio").count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: copy.share, exact: true }).click();
    await expect
      .poll(() =>
        helperPage
          .locator("video")
          .evaluate((element) => (element instanceof HTMLVideoElement ? element.videoWidth : 0)),
      )
      .toBeGreaterThan(0);
    const pointer = helperPage.getByRole("button", { name: copy.pointerHelp, exact: true });
    await pointer.hover();
    await expect(page.getByText(copy.helper, { exact: true })).toBeVisible();
    await pointer.click();
    await expect(page.locator("[data-helper-annotation]")).toHaveCount(1);
    await helperPage.getByRole("button", { name: copy.clear, exact: true }).click();
    await expect(page.locator("[data-helper-annotation]")).toHaveCount(0);
    await page.getByRole("button", { name: copy.pause, exact: true }).click();
    await expect(helperPage.getByText(copy.waitingScreen, { exact: true })).toBeVisible();
    await helperPage.getByRole("button", { name: copy.end, exact: true }).click();
    await expect(page.getByText(copy.ended, { exact: true })).toBeVisible();
    expect(
      (await context.request.post("/api/relatives/token", { data: { id: sessionId } })).status(),
    ).toBe(403);
    const livekitUrl = new URL(process.env.LIVEKIT_URL || "ws://localhost:7880");
    livekitUrl.protocol = livekitUrl.protocol === "wss:" ? "https:" : "http:";
    const livekit = new RoomServiceClient(
      livekitUrl.toString(),
      process.env.LIVEKIT_API_KEY || "devkey",
      process.env.LIVEKIT_API_SECRET || "secret",
    );
    expect(await livekit.listRooms([`relative-${sessionId}`])).toHaveLength(0);
  } finally {
    try {
      await helperContext.close();
    } finally {
      await subjects.deleteSubject(subject.id);
    }
  }
});

for (const scope of ["case", "none"] as const) {
  test(`FR-R5 ${scope === "case" ? "screen+case helper sees the journey" : "screen-only helper gets 403 on facts"}`, async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("TEST_BASE_URL_REQUIRED");
    const helperContext = await browser.newContext({ baseURL });
    const helperPage = await helperContext.newPage();
    await page.goto("/workspace/helpers");
    const identity = z
      .object({ userId: z.uuid() })
      .parse(await (await context.request.post("/api/session")).json());
    const subjects = createSubjectService(database, identity.userId);
    const subject = await subjects.createSubject({
      displayName: "Testperson",
      relationToUser: "self",
    });
    try {
      const result = await subjects.createCase({
        subjectId: subject.id,
        confirmedGoal: "Gemeinsam Unterlagen vorbereiten",
      });
      await database.db.insert(caseSteps).values({
        caseId: result.case.id,
        processStep: "Unterlagen prüfen",
        status: "in_progress",
        owner: "user",
        initiatedBy: "user",
      });
      await page.reload();
      await page.getByRole("combobox", { name: copy.scopeLabel }).selectOption(scope);
      await page.getByRole("button", { name: copy.invite, exact: true }).click();
      const link = await page.getByLabel(copy.link).inputValue();
      await helperPage.goto(link);
      await helperPage.getByRole("button", { name: copy.join, exact: true }).click();
      await expect(helperPage.getByText(copy.approval, { exact: true })).toBeVisible();
      expect(
        (
          await helperContext.request.get(
            `/api/facts?caseId=${result.case.id}&subjectId=${subject.id}`,
          )
        ).status(),
      ).toBe(403);
      await page.getByRole("button", { name: copy.approve, exact: true }).click();
      await expect(
        helperPage.getByRole("button", { name: copy.helperConnect, exact: true }),
      ).toBeVisible();
      const response = await helperContext.request.get(
        `/api/facts?caseId=${result.case.id}&subjectId=${subject.id}`,
      );
      if (scope === "case") {
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ facts: [] });
        await expect(
          helperPage.getByRole("heading", { name: "Gemeinsam Unterlagen vorbereiten" }),
        ).toBeVisible();
        await expect(helperPage.getByRole("heading", { name: "Unterlagen prüfen" })).toBeVisible();
      } else {
        expect(response.status()).toBe(403);
        expect(
          (await helperContext.request.get(`/api/workspace?caseId=${result.case.id}`)).status(),
        ).toBe(403);
        await expect(helperPage.getByRole("heading", { name: "Unterlagen prüfen" })).toHaveCount(0);
      }
      await page.getByRole("button", { name: copy.end, exact: true }).click();
      await expect(helperPage.getByText(copy.ended, { exact: true })).toBeVisible();
      expect(
        (
          await helperContext.request.get(
            `/api/facts?caseId=${result.case.id}&subjectId=${subject.id}`,
          )
        ).status(),
      ).toBe(403);
    } finally {
      await helperContext.close();
      await subjects.deleteSubject(subject.id);
    }
  });
}
