import type { Fact } from "@lotse/protocol";
import { WORKSPACE_CONFIG } from "./config.ts";
import {
  ExtractionResponseSchema,
  FactsResponseSchema,
  type ReviewableFact,
  UploadResponseSchema,
} from "./schemas.ts";

export async function workspaceFetch(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  if (!response.ok) throw new Error("WORKSPACE_REQUEST_FAILED");
  return response.json();
}

export async function loadFacts(subjectId: string, caseId: string): Promise<Fact[]> {
  return FactsResponseSchema.parse(
    await workspaceFetch(
      `${WORKSPACE_CONFIG.factsApi}?${new URLSearchParams({ subjectId, caseId })}`,
    ),
  ).facts;
}

export async function changeFact(
  fact: ReviewableFact,
  action: "confirm" | "reject" | "edit",
  value?: string,
): Promise<void> {
  // Proposals are transient until explicitly confirmed with their server-issued token.
  if (!fact.confirmed && action === "reject") return;
  if (!fact.confirmed && !fact.proposalToken) throw new Error("FACT_PROPOSAL_REQUIRED");
  const body = !fact.confirmed
    ? {
        proposalToken: fact.proposalToken,
        confirmed: true,
        ...(action === "edit" ? { value } : {}),
      }
    : action === "reject"
      ? { subjectId: fact.subjectId, factId: fact.id }
      : { subjectId: fact.subjectId, factId: fact.id, value: value ?? fact.value, confirmed: true };
  await workspaceFetch(WORKSPACE_CONFIG.factsApi, {
    method: !fact.confirmed ? "POST" : action === "reject" ? "DELETE" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function uploadDocument(
  file: File,
  subjectId: string,
  originClient: "web" | "mac",
): Promise<string> {
  const body = new FormData();
  body.set("subjectId", subjectId);
  body.set("file", file);
  body.set("originClient", originClient);
  return UploadResponseSchema.parse(
    await workspaceFetch(WORKSPACE_CONFIG.documentsApi, { method: "POST", body }),
  ).documentId;
}

export async function extractFacts(
  documentId: string,
  subjectId: string,
  caseId: string,
): Promise<ReviewableFact[]> {
  return ExtractionResponseSchema.parse(
    await workspaceFetch(
      `${WORKSPACE_CONFIG.documentsApi}/${encodeURIComponent(documentId)}/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, caseId }),
      },
    ),
  ).proposals;
}
