import type { Fact } from "@lotse/protocol";
import { afterEach, expect, test, vi } from "vitest";
import { changeFact, extractFacts, loadFacts, uploadDocument } from "../src/conversation/api.ts";
import { factCitation } from "../src/conversation/sources.ts";

const subjectId = crypto.randomUUID();
const caseId = crypto.randomUUID();
const documentId = crypto.randomUUID();
const fact: Fact = {
  id: crypto.randomUUID(),
  subjectId,
  type: "administrative_fact",
  value: "Original statement",
  source: { kind: "document", documentId, page: 2, quote: "Original statement" },
  confidence: 1,
  confirmed: true,
};

function mockFetch(result: unknown) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

test("conversation facts include subject and case scope for the authoritative API", async () => {
  const fetch = mockFetch({ facts: [fact] });
  expect(await loadFacts(subjectId, caseId)).toEqual([fact]);
  expect(fetch).toHaveBeenCalledWith(
    `/api/facts?subjectId=${subjectId}&caseId=${caseId}`,
    expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
  );
});

test("conversation uploads send subject and origin client to the document pipeline", async () => {
  const fetch = mockFetch({ documentId, subjectId });
  const file = new File(["synthetic fixture"], "document.pdf", { type: "application/pdf" });
  expect(await uploadDocument(file, subjectId, "mac")).toBe(documentId);
  expect(fetch).toHaveBeenCalledWith("/api/documents", expect.objectContaining({ method: "POST" }));
  const body = fetch.mock.calls[0]?.[1]?.body;
  expect(body).toBeInstanceOf(FormData);
  if (!(body instanceof FormData)) throw new Error("MISSING_MULTIPART_BODY");
  expect(body.get("subjectId")).toBe(subjectId);
  expect(body.get("originClient")).toBe("mac");
  expect(body.get("file")).toBe(file);
  expect(body.has("caseId")).toBe(false);
  expect(body.has("clientKind")).toBe(false);
});

test("extraction proposals remain drafts until explicitly confirmed with their signed token", async () => {
  const proposal = { ...fact, confirmed: false as const, proposalToken: "signed-proposal" };
  const fetch = mockFetch({ proposals: [proposal] });
  expect(await extractFacts(documentId, subjectId, caseId)).toEqual([proposal]);
  expect(fetch).toHaveBeenLastCalledWith(
    `/api/documents/${documentId}/extract`,
    expect.objectContaining({ method: "POST", body: JSON.stringify({ subjectId, caseId }) }),
  );
  await changeFact(proposal, "confirm");
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/facts",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ proposalToken: "signed-proposal", confirmed: true }),
    }),
  );
  await changeFact(proposal, "edit", "Corrected statement");
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/facts",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        proposalToken: "signed-proposal",
        confirmed: true,
        value: "Corrected statement",
      }),
    }),
  );
});

test("rejecting transient proposals performs no write and unsigned drafts cannot be confirmed", async () => {
  const fetch = mockFetch({});
  const draft = { ...fact, confirmed: false };
  await changeFact(draft, "reject");
  await expect(changeFact(draft, "confirm")).rejects.toThrow("FACT_PROPOSAL_REQUIRED");
  expect(fetch).not.toHaveBeenCalled();
});

test("saved fact edits explicitly confirm their value and rejection uses DELETE", async () => {
  const fetch = mockFetch({});
  await changeFact(fact, "edit", "Corrected statement");
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/facts",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        subjectId,
        factId: fact.id,
        value: "Corrected statement",
        confirmed: true,
      }),
    }),
  );
  await changeFact(fact, "reject");
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/facts",
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ subjectId, factId: fact.id }),
    }),
  );
});

test("document citations include subject authorization scope before the page fragment", () => {
  expect(factCitation(fact.id, fact.source, "Document", { subjectId }).url).toBe(
    `/api/documents/${documentId}?subjectId=${subjectId}#page=2`,
  );
});
