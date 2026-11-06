import type { createObjectStorage } from "@lotse/db/storage/s3";
import { z } from "zod";
import type { FactService } from "./facts.ts";
import { type DocumentPage, type DocumentStatement, documentPagesSchema } from "./schema.ts";

export type DocumentStorage = Pick<
  ReturnType<typeof createObjectStorage>,
  "get" | "put" | "delete"
>;
export const uploadSchema = z.strictObject({
  subjectId: z.uuid(),
  type: z.string().trim().min(1).max(200).default("uploaded_document"),
  originClient: z.enum(["web", "mac"]).default("web"),
  pages: documentPagesSchema.optional(),
});
export type DocumentUpload = z.input<typeof uploadSchema>;
const scopeSchema = z.strictObject({ subjectId: z.uuid(), caseId: z.uuid().optional() });
export const extractionInput = scopeSchema.extend({
  documentId: z.uuid(),
  pageRange: z.strictObject({ from: z.int().positive(), to: z.int().positive() }).optional(),
});
export type DocumentExtractionInput = z.infer<typeof extractionInput>;
export type DocumentProposal = {
  id: string;
  subjectId: string;
  type: DocumentStatement["type"];
  value: string;
  source: {
    kind: "document";
    documentId: string;
    page: number;
    bbox: DocumentStatement["bbox"];
    quote: string;
  };
  confirmed: false;
  proposalToken: string;
};

export type DocumentServiceOptions = {
  sessionId?: string;
  storage?: DocumentStorage;
  encryptionSecret?: string;
  proposalSecret?: string;
};
export type DocumentMediaType = "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
export type DocumentExtraction = { statements: DocumentStatement[]; proposals: DocumentProposal[] };
export interface DocumentService extends FactService {
  extract(raw: DocumentExtractionInput, signal?: AbortSignal): Promise<DocumentExtraction>;
  upload(
    bytes: Uint8Array,
    raw: DocumentUpload,
    signal?: AbortSignal,
  ): Promise<{
    documentId: string;
    subjectId: string;
    ocrStatus: "completed";
    pageCount: number;
    mediaType: DocumentMediaType;
  }>;
  read(
    raw: DocumentExtractionInput,
  ): Promise<{ bytes: Buffer; mediaType: DocumentMediaType; pages: DocumentPage[] }>;
  deleteDocument(raw: DocumentExtractionInput): Promise<{ deleted: true }>;
}
