import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createSubjectService } from "@lotse/brain/subjects";
import { createDatabase } from "@lotse/db";
import { documents, subjects } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { z } from "zod";

const identitySchema = z.object({ userId: z.uuid(), sessionId: z.uuid() });

test("@source-highlight FR-D4 marks a stored original only when its speech sentence starts", async ({
  page,
  context,
}) => {
  const database = createDatabase();
  const storage = createObjectStorage();
  const key = `source-highlight-test/${randomUUID()}`;
  let subjectId: string | undefined;
  try {
    await page.goto("/");
    const response = await context.request.post("/api/session");
    const identity = identitySchema.parse(await response.json());
    const service = createSubjectService(database, identity.userId, identity.sessionId);
    const subject = await service.createSubject({
      displayName: "Source viewer test",
      relationToUser: "self",
    });
    subjectId = subject.id;
    const created = await service.createCase({ subjectId, confirmedGoal: "Unterlagen ansehen" });
    const root = new URL("../../../", import.meta.url);
    const directory = process.env.SVBOX_DIR
      ? new URL(`${process.env.SVBOX_DIR.replace(/\/$/u, "")}/Anträge und Formulare/`, root)
      : new URL("data/svbox/Anträge und Formulare/", root);
    const filename = (await readdir(directory)).sort().find((name) => name.endsWith(".pdf"));
    if (!filename) throw new Error("ORIGINAL_PDF_REQUIRED");
    const content = await readFile(new URL(filename, directory));
    await storage.put(key, content, "application/pdf");
    const documentId = randomUUID();
    await database.db.insert(documents).values({
      id: documentId,
      subjectId,
      type: "Imported original",
      storageKey: key,
      hash: createHash("sha256").update(content).digest("hex"),
      originClient: "web",
      ocrStatus: "completed",
    });
    await page.goto(`/documents?caseId=${created.case.id}`);
    await page.getByRole("button", { name: "Dokument ansehen" }).click();
    const viewer = page.getByRole("region", { name: "Originaldokument" });
    await expect(viewer.locator(".textLayer span").first()).toBeVisible();
    const quote = await viewer.locator(".textLayer span").evaluateAll((spans) => {
      const texts = spans.map((span) => span.textContent ?? "");
      return (
        texts.find(
          (text) =>
            text.trim().length > 12 && texts.filter((entry) => entry.includes(text)).length === 1,
        ) ?? ""
      );
    });
    expect(quote.length).toBeGreaterThan(12);
    // The audio clock is the only test double.
    await page.evaluate(
      ({ documentId, quote }) => {
        const queued: SpeechSynthesisUtterance[] = [];
        Object.defineProperty(window.speechSynthesis, "speak", {
          value: (utterance: SpeechSynthesisUtterance) => queued.push(utterance),
          configurable: true,
        });
        Object.defineProperty(window, "__sourceTestStart", {
          value: () => queued[0]?.dispatchEvent(new Event("start")),
          configurable: true,
        });
        window.dispatchEvent(
          new CustomEvent("lotse:guidance-part", {
            detail: {
              type: "data-action",
              data: {
                id: "source-mark",
                kind: "highlight",
                target: { kind: "text", documentId, page: 1, quote },
                payload: {},
                sentenceIndex: 0,
              },
            },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("lotse:guidance-part", {
            detail: {
              type: "data-speech-segment",
              data: {
                turnId: "source-turn",
                index: 0,
                text: quote,
                language: "de-AT",
                citations: [],
                actionIds: ["source-mark"],
              },
            },
          }),
        );
      },
      { documentId, quote },
    );
    await expect(viewer.locator("[data-quote-box]")).toHaveCount(0);
    const elapsed = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (!document.querySelector("[data-quote-box]")) return;
            observer.disconnect();
            resolve(performance.now() - started);
          });
          observer.observe(document.body, { childList: true, subtree: true });
          const start = Reflect.get(window, "__sourceTestStart");
          if (typeof start === "function") start();
        }),
    );
    expect(elapsed).toBeLessThan(600);
    await expect(viewer.locator("[data-quote-box]").first()).toBeVisible();
    const box = await viewer.locator("[data-quote-box]").first().boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Vorlesen stoppen" }).click();
    await expect(viewer.locator("[data-quote-box]").first()).toBeVisible();
    const stranger = await context.browser()?.newContext();
    if (!stranger) throw new Error("BROWSER_REQUIRED");
    try {
      await stranger.request.get("/");
      const denied = await stranger.request.get(
        `/api/documents?caseId=${created.case.id}&documentId=${documentId}`,
      );
      expect(denied.status()).toBe(404);
    } finally {
      await stranger.close();
    }
  } finally {
    if (subjectId) await database.db.delete(subjects).where(eq(subjects.id, subjectId));
    await storage.delete(key);
    storage.close();
    await database.close();
  }
});
