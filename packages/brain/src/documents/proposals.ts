import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DOCUMENT_PROPOSAL_TTL_MS } from "./config.ts";
import { DocumentError, type FactProposal, proposalSchema } from "./schema.ts";

function signature(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`lotse-document-fact-v1:${body}`).digest();
}
export function signProposal(
  input: Omit<FactProposal, "id" | "expiresAt">,
  secret: string,
  now = Date.now(),
): { proposalToken: string; proposal: FactProposal } {
  z.string().min(32).parse(secret);
  const proposal = proposalSchema.parse({
    ...input,
    id: randomUUID(),
    expiresAt: now + DOCUMENT_PROPOSAL_TTL_MS,
  });
  const body = Buffer.from(JSON.stringify(proposal)).toString("base64url");
  return { proposal, proposalToken: `${body}.${signature(body, secret).toString("base64url")}` };
}
export function verifyProposal(
  token: string,
  secret: string,
  userId: string,
  now = Date.now(),
): FactProposal {
  try {
    z.string().min(32).parse(secret);
    const parts = token.split(".");
    const [body, mac] = parts;
    if (parts.length !== 2 || !body || !mac) throw new DocumentError("invalid_proposal");
    const actual = Buffer.from(mac, "base64url");
    const expected = signature(body, secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new DocumentError("invalid_proposal");
    const proposal = proposalSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    if (proposal.userId !== userId || proposal.expiresAt <= now)
      throw new DocumentError("invalid_proposal");
    return proposal;
  } catch {
    throw new DocumentError("invalid_proposal");
  }
}
