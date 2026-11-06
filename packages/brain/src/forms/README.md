# Form runtime

`tools/impl/form` and `tools/impl/form-live` use the persisted `form_template` and
`form_instance` tables; the build fixture switch never enables fixtures for these tools.

- Catalog-loaded SV-Box schemas are read from the registry, including their fact mappings,
  sources and review state. Development reads originals beneath `SVBOX_DIR` (otherwise the
  repository's `data/svbox`, resolved from this module). Production reads each registered
  `storageKey` from S3; an explicit `SVBOX_DIR` also permits a mounted source directory.
  Paths stay beneath the resolved root and every original is checked against its stored hash.
- Catalog schemas lacking widget geometry are enriched through the existing detector. An
  analysis remains `auto`; it never claims human verification. Provider ownership and signature
  restrictions apply to every widget sharing the same native AcroForm field.
- Prefill accepts only confirmed, unambiguous, primitive values matching the schema's `fact_type`.
  A source quote is required. IBANs require direct statement facts. Unmapped detected fields
  have an instance-independent, template-specific fact type; there is no inferred medical or
  personal-data mapping. Missing values are returned to the caller for collection/review.
- Live fill validates the complete group and emits one protocol `data-action` of kind `type`
  per field. `payload.pace` is the interval between keystrokes; display clients perform pacing
  and interruption. Facts withdrawn since prefill cannot be typed.
- Commit requires the existing approval module to have consumed a matching approval, including
  case, actor, session, tool-call id and exact input hash. Commit locks the approval and instance;
  its audit row prevents replay. Approved corrections become statement facts. An IBAN correction
  requires an independently recorded statement fact. Helpers and L1 cannot commit or live-fill.
- Package output always starts with the original, clears native defaults, and fills only confirmed
  applicant values. Detected boxes become editable AcroForm fields, including on cropped/rotated
  pages. The attachment checklist comes from catalog records; nothing is submitted.
- Acquisition follows only exact HTTPS origins from `packages/knowledge/allowlist.yaml`, including
  redirects, with bounded streaming and cancellation. Every acquisition rechecks bytes. Identical
  hashes reuse the original and schema; changed hashes create an `auto` template version. HTML and
  XFA forms fail explicitly because the current detector/PDF writer does not support those formats.
- Discovery searches the registry first, then catalog source pages, indexed official pages and the
  existing ingestion seeds. Navigation is bounded, stays on the allowlist and returns only published
  PDF links. Sites without a discoverable download require an explicit official download URL.

Authenticated downloads are available at `/api/forms/:instanceId/pdf` and the PRD alias
`/api/forms/instances/:instanceId/pdf`. Both render the current confirmed values, authorize the
subject actor and send private, non-cacheable responses.

`POST /api/forms/instances/:instanceId/package` derives the case and subject from the authenticated
instance, calls the same package builder as `package.build`, and returns `attachmentChecklist`,
`coverLetter` and an authenticated `pdfUrl`. Storage keys remain server-side. The viewer's
“Paket erstellen” action shows these three artifacts; it never submits them. A correction or newly
confirmed field group clears the displayed package. The letter uses the subject's display name,
the current Vienna date, required catalog attachments and the latest persisted `office.resolve`
result for a linked benefit. Catalog search hints are linked through persisted `form.find` results.
If no matching office was resolved or attachments are not recorded, the letter explicitly asks
for clarification rather than inventing a recipient or claiming documents are enclosed.

`form.acquire` uses the signed runtime approval flow. Its summary shows the candidate publisher,
title, version date (or an explicit unknown date) and exact allowlisted URL before downloading.
Metadata comes from persisted search results or a known registry entry, never a pre-consent download.
`GET /api/forms/templates?need=...&region=...&carrier=...` delegates to `findForms`.
`POST /api/forms/templates` accepts `{ "url": "...", "approved": true }` for an explicit manual
registration through `acquireForm`; `approved: false` returns `{ "registered": false }` without
downloading or registering. Both require a session; writes reject cross-origin requests. Registration
and every redirect retain the acquisition allowlist.

Run from the repository root:

```sh
bun run typecheck
bun run --filter @lotse/brain test -- test/forms/runtime
bun run --filter @lotse/brain test:forms:integration
bun run --filter @lotse/web test -- test/forms.test.ts
bun run --filter @lotse/web build
```

Integration tests create/drop an isolated real Postgres database and use a unique MinIO prefix.
They exercise original SV-Box PDFs, persistence, approvals, replay, corrections, PDF output and
versioned acquisition. Only official-site HTTP responses are doubled inside that test file;
detection and storage are real. The offline tests also cover ownership, IBAN provenance, field
validation, redirect rejection, cancellation, flat PDFs and all four page rotations.
