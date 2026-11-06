export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_MAX_PAGES = 100;
export const DOCUMENT_MAX_LINES = 4000;
export const DOCUMENT_MAX_TEXT = 300_000;
export const DOCUMENT_MODEL_TIMEOUT_MS = 120_000;
export const DOCUMENT_MAX_OUTPUT_TOKENS = 12_000;
export const DOCUMENT_PROPOSAL_TTL_MS = 60 * 60_000;
export const DOCUMENT_MIN_TEXT_CHARACTERS = 20;
export const DOCUMENT_MAX_STATEMENTS = 250;
export const DOCUMENT_ROW_TOLERANCE_POINTS = 5;
export const DOCUMENT_EXTRACTION_VERSION = "brain-extraction/2";
export const DOCUMENT_PARAGRAPH_LINE_HEIGHT_RATIO = 1.65;
export const DOCUMENT_MAX_REQUEST_BYTES = DOCUMENT_MAX_BYTES * 2;
export const DOCUMENT_OCR_ATTEMPTS = 2;
export const DOCUMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_KEY_BYTES = 32;
export const DOCUMENT_NONCE_BYTES = 12;
export const DOCUMENT_TAG_BYTES = 16;
export const DOCUMENT_KEY_CONTEXT = "lotse/document-envelope/v1";
export const DOCUMENT_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;
