import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";

function validateUnicode(value: unknown): void {
  if (
    typeof value === "string" &&
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw new Error("Invalid JSON Unicode");
  if (Array.isArray(value)) value.forEach(validateUnicode);
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      validateUnicode(key);
      validateUnicode(child);
    }
  }
}

export function canonicalJson(input: unknown): string {
  const value = z.json().parse(input);
  validateUnicode(value);
  const result = canonicalize(value);
  if (result === undefined) throw new Error("Invalid JSON input");
  return result;
}

export function inputHash(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export type ApprovalBinding = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  inputHash: string;
};
export function approvalHmac(binding: ApprovalBinding, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(binding)).digest("hex");
}
export function equalHmac(actual: string, expected: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  );
}
