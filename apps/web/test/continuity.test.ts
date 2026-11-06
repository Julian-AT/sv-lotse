import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { loadConversation } from "../src/conversation/load.ts";

test("case opening resumes through an authenticated POST and reloads validated persisted history", async () => {
  const caseId = randomUUID();
  const messages = [
    { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Unterlagen ordnen" }] },
  ];
  // Test-only HTTP fixture: persistence itself is covered against real Postgres.
  const fetcher: typeof fetch = async (url, init) => {
    expect(url).toBe(`/api/cases/${caseId}/conversation`);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    return Response.json({ caseId, subjectId: randomUUID(), messages, jobs: [] });
  };
  expect((await loadConversation(caseId, new AbortController().signal, fetcher)).messages).toEqual(
    messages,
  );
});

test("failed or mismatched case loads never supply replacement history", async () => {
  const caseId = randomUUID();
  await expect(
    loadConversation(
      caseId,
      new AbortController().signal,
      async () => new Response(null, { status: 403 }),
    ),
  ).rejects.toThrow("CONVERSATION_LOAD_FAILED");
  await expect(
    loadConversation(caseId, new AbortController().signal, async () =>
      Response.json({ caseId: randomUUID(), subjectId: randomUUID(), messages: [], jobs: [] }),
    ),
  ).rejects.toThrow("CONVERSATION_LOAD_FAILED");
});

test("a new persisted case opens with an empty conversation", async () => {
  const caseId = randomUUID();
  const snapshot = await loadConversation(caseId, new AbortController().signal, async () =>
    Response.json({ caseId, subjectId: randomUUID(), messages: [], jobs: [] }),
  );
  expect(snapshot.messages).toEqual([]);
});
