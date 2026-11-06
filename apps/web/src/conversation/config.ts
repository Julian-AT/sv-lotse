export const WORKSPACE_CONFIG = {
  workspacePath: "/workspace",
  turnApi: "/api/turn",
  casesApi: "/api/cases",
  caseListApi: "/api/cases?view=workspace",
  factsApi: "/api/facts",
  documentsApi: "/api/documents",
  appVersion: "0.0.0",
  typingPaceMs: 35,
  maxUploadBytes: 20 * 1024 * 1024,
  acceptedDocuments: ["application/pdf", "image/jpeg", "image/png"],
  /** Retrieval tool whose passages carry the validity date shown as a citation's as-of date. */
  passageTool: "kb.search",
  /** Brain tools cite imported documents as `document:<id>#page=<n>`. */
  documentSourceProtocol: "document:",
  /** Fee schedules state reimbursement amounts in euro. */
  reimbursementCurrency: "EUR",
  /** CSS pixel width of the page-1 thumbnail in the import preview. */
  importPreviewWidth: 240,
} as const;
