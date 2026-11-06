import { randomUUID } from "node:crypto";
import { documents, messages, users } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDocumentService } from "../../src/documents/index.ts";
import { signProposal } from "../../src/documents/proposals.ts";
import { documentPagesSchema } from "../../src/documents/schema.ts";
import { createWorkspaceService } from "../../src/workspace/index.ts";
import { isolatedDatabase } from "../runtime/helpers.ts";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  await database?.cleanup();
});

test("§6 cases, messages, facts and actual document bytes persist with subject ownership", async () => {
  const userId = randomUUID();
  const strangerId = randomUUID();
  await database.db.insert(users).values([{ id: userId }, { id: strangerId }]);
  const owner = createWorkspaceService(database.db, userId);
  const stranger = createWorkspaceService(database.db, strangerId);
  const created = await owner.createCase();
  const second = await owner.createCase();
  expect(second.subjectId).toBe(created.subjectId);
  expect(await owner.listCases()).toHaveLength(2);
  expect(await stranger.listCases()).toEqual([]);
  await expect(stranger.history(created.id)).rejects.toMatchObject({ code: "CASE_ACCESS_DENIED" });
  const message = {
    id: randomUUID(),
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Please help me with my administrative documents." }],
  };
  await database.db
    .insert(messages)
    .values({ caseId: created.id, position: 0, uiMessage: message });
  expect(await owner.history(created.id)).toEqual([message]);

  const storage = createObjectStorage();
  const secret = "workspace-integration-test-secret-with-32-characters";
  const options = { storage, encryptionSecret: secret, proposalSecret: secret };
  const ownerDocuments = createDocumentService(database.db, userId, options);
  const strangerDocuments = createDocumentService(database.db, strangerId, options);
  // Synthetic administrative PDF exercises the real document pipeline without clinical data.
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText("Original administrative statement for testing upload and fact confirmation.");
  const bytes = await pdf.save();
  const uploaded = await ownerDocuments.upload(bytes, { subjectId: created.subjectId });
  const scope = {
    subjectId: created.subjectId,
    caseId: created.id,
    documentId: uploaded.documentId,
  };
  try {
    const [document] = await database.db
      .select()
      .from(documents)
      .where(eq(documents.id, uploaded.documentId));
    if (!document) throw new Error("DOCUMENT_MISSING");
    expect(await storage.get(document.storageKey)).not.toEqual(Buffer.from(bytes));
    expect((await ownerDocuments.read(scope)).bytes).toEqual(Buffer.from(bytes));
    await expect(strangerDocuments.read(scope)).rejects.toMatchObject({ code: "access_denied" });
    const page = documentPagesSchema.parse(document.pages)[0];
    const line = page?.lines[0];
    if (!page || !line) throw new Error("DOCUMENT_TEXT_MISSING");
    // A signed test-only proposal isolates persistence from the live extraction provider.
    const { proposalToken } = signProposal(
      {
        userId,
        subjectId: created.subjectId,
        documentId: uploaded.documentId,
        documentHash: document.hash,
        statement: {
          type: "administrative_fact",
          quote: line.text,
          page: page.page,
          bbox: line.bbox,
        },
      },
      secret,
    );
    expect(
      await ownerDocuments.listFacts({ subjectId: created.subjectId, caseId: created.id }),
    ).toEqual([]);
    await expect(
      strangerDocuments.confirmFact({ proposalToken, confirmed: true }),
    ).rejects.toMatchObject({ code: "invalid_proposal" });
    const fact = await ownerDocuments.confirmFact({ proposalToken, confirmed: true });
    expect(
      (await ownerDocuments.listFacts({ subjectId: created.subjectId, caseId: created.id }))[0]
        ?.confirmed,
    ).toBe(true);
    await ownerDocuments.editFact({
      subjectId: created.subjectId,
      factId: fact.id,
      confirmed: true,
      value: "Corrected statement",
    });
    expect(
      (await ownerDocuments.listFacts({ subjectId: created.subjectId, caseId: created.id }))[0],
    ).toMatchObject({ confirmed: true, value: "Corrected statement" });
    await expect(
      strangerDocuments.deleteFact({ subjectId: created.subjectId, factId: fact.id }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await ownerDocuments.deleteFact({ subjectId: created.subjectId, factId: fact.id });
    expect(
      await ownerDocuments.listFacts({ subjectId: created.subjectId, caseId: created.id }),
    ).toEqual([]);
  } finally {
    await ownerDocuments.deleteDocument(scope);
    storage.close();
  }
});
