import { createHash } from "node:crypto";

/** UUIDv8, stable across edits to an obligation's date or wording. */
export function reminderId(caseId: string, key: string): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify(["deadline", caseId, key]))
    .digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
