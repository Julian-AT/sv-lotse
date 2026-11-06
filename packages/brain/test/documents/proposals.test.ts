import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { scopedFactTypes } from "../../src/documents/access.ts";
import { decryptOriginal, encryptOriginal } from "../../src/documents/encryption.ts";
import { signProposal, verifyProposal } from "../../src/documents/proposals.ts";

const secret = "test-document-secret-with-at-least-32-characters";
const proposal = {
  userId: randomUUID(),
  subjectId: randomUUID(),
  documentId: randomUUID(),
  documentHash: "test-hash",
  statement: {
    type: "administrative_fact" as const,
    page: 1,
    quote: "Ausstellungsdatum: 06.11.2026",
    bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.03 },
  },
};

test("FR-P3 confirmation proposals bind identity, source and expiry without storing a fact", () => {
  const signed = signProposal(proposal, secret, 1000);
  expect(verifyProposal(signed.proposalToken, secret, proposal.userId, 1001)).toEqual(
    signed.proposal,
  );
  expect(() => verifyProposal(signed.proposalToken, secret, randomUUID(), 1001)).toThrow(
    "invalid_proposal",
  );
  expect(() =>
    verifyProposal(signed.proposalToken, secret, proposal.userId, signed.proposal.expiresAt),
  ).toThrow("invalid_proposal");
  const [body, mac] = signed.proposalToken.split(".");
  const tampered = Buffer.from(
    JSON.stringify({ ...signed.proposal, subjectId: randomUUID() }),
  ).toString("base64url");
  expect(() => verifyProposal(`${tampered}.${mac}`, secret, proposal.userId, 1001)).toThrow(
    "invalid_proposal",
  );
  expect(() => verifyProposal(`${body}.AA`, secret, proposal.userId, 1001)).toThrow(
    "invalid_proposal",
  );
});

test("FR-P1 encrypts each original with a fresh wrapped data key bound to its storage path", () => {
  const original = Buffer.from("Private original bytes");
  const encrypted = encryptOriginal(original, secret, "documents/one");
  expect(encrypted.includes(original)).toBe(false);
  expect(decryptOriginal(encrypted, secret, "documents/one")).toEqual(original);
  expect(encryptOriginal(original, secret, "documents/one")).not.toEqual(encrypted);
  expect(() => decryptOriginal(encrypted, secret, "documents/two")).toThrow("storage_failed");
  expect(() => decryptOriginal(encrypted, `${secret}-wrong`, "documents/one")).toThrow(
    "storage_failed",
  );
});

test("FR-P1 helper fact grants default to none and support both persisted scope formats", () => {
  expect(scopedFactTypes("helper", {})).toEqual([]);
  expect(
    scopedFactTypes("helper", { mode: "restricted", factTypes: ["administrative_fact"] }),
  ).toEqual(["administrative_fact"]);
  expect(scopedFactTypes("helper", { facts: ["documented_recommendation"] })).toEqual([
    "documented_recommendation",
  ]);
  expect(scopedFactTypes("helper", { mode: "full" })).toBeNull();
  expect(scopedFactTypes("helper", { mode: "invalid", facts: true })).toEqual([]);
  expect(scopedFactTypes("helper", { mode: "restricted", factTypes: [], facts: true })).toEqual([]);
  expect(scopedFactTypes("subject", {})).toBeNull();
});
