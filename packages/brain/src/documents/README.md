# Documents and confirmed context

`@lotse/brain/documents` binds the shared database and object storage to an authenticated user.
The original is encrypted with a fresh AES-256-GCM data key; a purpose-separated HKDF key derived
from `SESSION_SECRET` wraps that data key. Both encrypted blobs authenticate their storage key.
Retain this secret for the lifetime of stored documents; changing it requires rewrapping originals.
Page text and normalized, top-left line boxes live in the existing `document.pages` JSON column.
No migration or additional provider is required.

Uploads accept PDF, PNG, JPEG and WebP by file signature, up to 25 MiB and 100 PDF pages. Each PDF
page uses its text layer when available, otherwise the model router's `extractor` reads a rendered
page image. PDF.js uses the existing Node canvas renderer. Device OCR can supply validated pages
instead; each page is `{ page, width, height, text, lines: [{ text, bbox }], method: "device_ocr" }`.
Pages are one-based and consecutive. `text` must equal line text joined with newlines. Bboxes use
normalized displayed-page coordinates, including PDF rotation and CropBox.

Extraction returns only two statement types: `documented_recommendation` and `administrative_fact`.
PDF text-layer strings retain their original whitespace; visual rows group baselines within five
points and retain the union of their source boxes. Sections persist across page breaks, including
when `pageRange` selects only a continuation page. The sourced headings, field rules, clinical
exclusions and classification instructions live in `packages/knowledge/data/document-extraction.json`,
validated through the public `@lotse/knowledge/document-policy` export.

The server constructs source candidates for sentences, fields, complete task-table rows (including
responsibilities) and vaccination records. Explicit administrative metadata and navigation tasks
are quoted directly. The extractor selects remaining candidates by id and type; it can select a
verbatim substring for a medicine name or field, but cannot combine sentences or truncate table rows.
Clinical sections expose only explicitly labelled administrative metadata. Findings, diagnoses,
treatment instructions, rehabilitation rationale/goals and generic medicine groups are excluded.
The fullest printed visit interval replaces its duplicate shorter header without reconciling
conflicting case numbers. OCR still uses the existing real provider fallback.

Each quotation must occur in its own source candidate. Whitespace differences are restored to the
unchanged source substring; no non-whitespace character is changed. Boxes come from the selected
source offset, including repeated text, rather than model-generated coordinates or the first equal
sentence on the page. Recommendations remain verbatim throughout confirmation and edits. Model
content is untrusted data and cannot call tools or approve actions.

## HTTP flow

1. `POST /api/documents`: multipart `file`, `subjectId`, optional `type` (catalog attachment type),
   `originClient` (`web` or `mac`), and optional JSON `pages`. Returns `documentId`, `ocrStatus`,
   `pageCount`, `subjectId`, and `mediaType`. Upload does not create facts.
2. `POST /api/documents/:id/extract`: JSON `{ subjectId, caseId?, pageRange?: { from, to } }`.
   Returns `{ statements, proposals }`. Each proposal includes the value, type, original quote,
   document id, page, box, and opaque `proposalToken`. Show this information for review.
   Proposals are not persisted in the fact table. Already-confirmed quotes are not proposed again. The frozen `docs.extractStatements` tool returns
   the same statement list, without changing its contract.
3. `POST /api/facts`: JSON `{ proposalToken, confirmed: true, value? }`. The optional value is an
   explicitly reviewed correction to an administrative fact. Recommendation values cannot be
   paraphrased. A proposal is bound to its user, subject, document hash, quote and one-hour expiry.
   Reconfirming the same proposal returns the existing fact without another insert.
4. `GET /api/facts?subjectId=...&caseId=...&factTypes=...`: returns `{ facts }`, confirmed rows only.
   A creator can omit caseId. Other actors must select one case, and its current persisted scope
   limits visible types. Grants from different cases are never combined. `context.queryFacts`
   reads this same path and rechecks the persisted actor instead of trusting stale runtime grants.
5. `PATCH /api/facts`: JSON `{ subjectId, factId, value, confirmed: true }` keeps original provenance.
   `DELETE /api/facts`: JSON `{ subjectId, factId }`; foreign keys delete derived facts as well.
6. `GET /api/documents/:id?subjectId=...&caseId=...`: authenticated original for the viewer.
   `DELETE` at the same URL removes the object and document, cascading derived facts.
   Partial helper scopes cannot read full documents or run extraction.

Every route requires the shared signed session and checks browser origin. Responses are private,
non-cacheable, and errors carry fixed codes rather than provider content. Request bodies are bounded
even without Content-Length. Subject creators and subject actors may mutate context; invited
helpers cannot confirm, edit or delete another person's facts.

## Verification

- `bun run --filter @lotse/brain test -- test/documents`: real discharge text layer, rotated
  CropBox geometry, grounding, proposal tampering/expiry, and envelope authentication.
- `bun run --filter @lotse/brain test:documents:integration`: real Postgres and MinIO, encrypted
  round trip, proposal/confirmation persistence, helper scope revocation, registered docs tool,
  and cascading deletion. Uses a disposable migrated database and removes its objects.
- `RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/documents`: real OpenAI extraction
  from the seven-page challenge discharge PDF, image OCR and automatically detected scanned PDF.
  Invalid OCR geometry receives at most one further model attempt. Test rasterizations stay in memory; `SVBOX_DIR` resolves from the repository root.
- `bun run --filter @lotse/web test -- test/documents.test.ts`: HTTP validation, sessions,
  origins, proposals, edits/deletion and content-free errors.

The offline regression tests cover all 37 annotated discharge spans, offset table baselines,
repeated-quote positioning, continuation-page ranges and clinical/medication exclusions. The live
extraction evaluation is `bun run evals --suite E12 --out /tmp/lotse-e12/summary.json`; see
[`docs/evals/results.md`](../../../../docs/evals/results.md) for measured results. E12 still has only
15 documents and no independent physical gold boxes, so its 30-document release gate and physical
position accuracy are not established by the quote-matching score.

After a production build, `cd apps/web && node --experimental-strip-types scripts/verify-documents-production.mjs` runs the full HTTP flow against the standalone server, a disposable database, real MinIO and real OpenAI. It removes its documents, temporary database and server when finished. Requires a working Node.js 22+ executable.
