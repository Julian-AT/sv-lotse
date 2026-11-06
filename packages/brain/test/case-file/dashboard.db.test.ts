import { randomUUID } from "node:crypto";
import {
  cases,
  documents,
  formInstances,
  formTemplates,
  messages,
  subjects,
  turns,
} from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { dashboardTitle } from "../../src/case-file/dashboard.ts";
import { createCaseDashboardService, createCaseFileService } from "../../src/case-file/index.ts";
import { createConversationWorkspaceService } from "../../src/workspace/conversation.ts";
import { identity, isolatedDatabase } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let storage: ReturnType<typeof createObjectStorage>;
const keys = new Set<string>();
beforeAll(async () => {
  database = await isolatedDatabase();
  storage = createObjectStorage({ ...process.env, S3_PREFIX: `dashboard-tests/${randomUUID()}` });
  await storage.headBucket();
});
afterAll(async () => {
  if (storage) {
    for (const key of keys) await storage.delete(key);
    storage.close();
  }
  await database?.cleanup();
});

// Synthetic user histories exercise mutable metadata; challenge source documents remain untouched.
async function setup() {
  const owner = await identity(database.db);
  const conversation = await createConversationWorkspaceService(
    database.db,
    owner.userId,
  ).createCase();
  return { owner, conversation, service: createCaseDashboardService(database.db, owner.userId) };
}

test("dashboard uses the latest persisted transcript activity and rename never confirms a goal", async () => {
  const { owner, conversation, service } = await setup();
  const at = new Date("2026-11-06T12:30:00.000Z");
  await database.db.insert(messages).values({
    caseId: conversation.id,
    position: 0,
    createdAt: at,
    uiMessage: {
      id: randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "Unterlagen vorbereiten" }],
    },
  });
  await database.db
    .update(cases)
    .set({ journeyMap: { process: { checkpoint: true } } })
    .where(eq(cases.id, conversation.id));
  await service.rename(conversation.id, { title: "Meine Unterlagen" });
  expect(await service.list()).toEqual([
    { id: conversation.id, title: "Meine Unterlagen", lastActivity: at.toISOString() },
  ]);
  const record = await createCaseFileService(database.db, owner.userId).get(conversation.id);
  expect(record.confirmedGoal).toBe("");
  const [stored] = await database.db.select().from(cases).where(eq(cases.id, conversation.id));
  expect(stored?.journeyMap).toEqual({
    process: { checkpoint: true },
    dashboardTitle: "Meine Unterlagen",
  });
  await expect(service.rename(conversation.id, { title: " " })).rejects.toMatchObject({
    code: "invalid_input",
  });
});

test("dashboard denies another user reads and mutations and rejects deleting an active turn", async () => {
  const { conversation, service } = await setup();
  const stranger = await identity(database.db);
  const other = createCaseDashboardService(database.db, stranger.userId);
  expect(await other.list()).toEqual([]);
  await expect(other.rename(conversation.id, { title: "Fremder Chat" })).rejects.toMatchObject({
    code: "access_denied",
  });
  const storage = {
    delete: async () => {
      throw new Error("No objects should be deleted");
    },
  };
  await expect(other.delete(conversation.id, storage)).rejects.toMatchObject({
    code: "access_denied",
  });
  await database.db.insert(turns).values({ caseId: conversation.id, status: "running" });
  await expect(service.delete(conversation.id, storage)).rejects.toMatchObject({
    code: "case_busy",
  });
});

test("deleting a conversation removes its history and retains the subject and other conversations", async () => {
  const { owner, conversation, service } = await setup();
  const second = await createConversationWorkspaceService(database.db, owner.userId).createCase();
  await database.db.insert(messages).values({
    caseId: conversation.id,
    position: 0,
    uiMessage: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Meine Frage" }] },
  });
  await service.delete(conversation.id, {
    delete: async () => {
      throw new Error("No form output expected");
    },
  });
  expect((await service.list()).map((item) => item.id)).toEqual([second.id]);
  expect(
    await database.db.select().from(messages).where(eq(messages.caseId, conversation.id)),
  ).toEqual([]);
  expect(
    await database.db.select().from(subjects).where(eq(subjects.id, conversation.subjectId)),
  ).toHaveLength(1);
});

test("dashboard falls back to confirmed goals for legacy journeys", () => {
  expect(dashboardTitle([], "Unterlagen prüfen")).toBe("Unterlagen prüfen");
  expect(dashboardTitle({ dashboardTitle: "Eigener Titel" }, "Unterlagen prüfen")).toBe(
    "Eigener Titel",
  );
});

test("conversation deletion removes its real form output but retains output referenced by a subject document", async () => {
  const { conversation, service } = await setup();
  const templateId = randomUUID();
  const ownedKey = `forms/${randomUUID()}.pdf`;
  const sharedKey = `forms/${randomUUID()}.pdf`;
  keys.add(ownedKey);
  keys.add(sharedKey);
  await storage.put(ownedKey, Buffer.from("User-owned generated form"));
  await storage.put(sharedKey, Buffer.from("Shared user document"));
  await database.db.insert(formTemplates).values({
    id: templateId,
    publisher: "Test fixture",
    title: "Test form",
    source: `https://example.org/forms/${templateId}`,
    hash: templateId,
    format: "flat",
    pages: 1,
    schema: {},
    storageKey: "unused-template",
  });
  await database.db.insert(formInstances).values(
    [ownedKey, sharedKey].map((outputKey) => ({
      caseId: conversation.id,
      subjectId: conversation.subjectId,
      templateId,
      fields: {},
      outputKey,
    })),
  );
  await database.db.insert(documents).values({
    subjectId: conversation.subjectId,
    storageKey: sharedKey,
    type: "letter",
    hash: randomUUID(),
    ocrStatus: "completed",
    originClient: "web",
  });
  await service.delete(conversation.id, storage);
  await expect(storage.get(ownedKey)).rejects.toBeDefined();
  expect((await storage.get(sharedKey)).toString()).toBe("Shared user document");
});
