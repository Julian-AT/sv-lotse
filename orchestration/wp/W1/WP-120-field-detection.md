---
id: WP-120
title: Field detection for flat and scanned PDFs with owner sections and E13 harness
wave: W1
lane: forms
risk: normal
codex_effort: xhigh
depends_on: [WP-004, WP-111]
fr: [FR-D11, E13]
owns:
  - packages/brain/src/forms/detect/**
  - packages/brain/test/forms/detect/**
  - packages/evals/src/e13/**
  - docs/adr/0120-form-field-detection.md
may_touch:
  - packages/brain/package.json
  - bun.lock
allow_deps: "`pdfjs-dist` (latest stable, legacy Node build) in `@lotse/brain`"
live_services: [openai]
gates:
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test -- test/forms/detect
  - bun run --filter @lotse/evals typecheck
  - RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/forms/detect
pr_title: "feat(forms): detect fields in flat and scanned pdfs"
---

# WP-120: Field detection for flat and scanned PDFs with owner sections and E13 harness

## Goal

Given a PDF form without (complete) AcroForm fields, the brain detects its fields: label, box,
type (text, date, number, checkbox, choice, signature), owner section and a confidence, as a
draft `FormSchema`. AcroForm PDFs are read directly. The E13 suite measures detection against gold
boxes. This is the core of `form.analyze` and of filling forms acquired on demand.

## Context

- PRD §10 "Form registry and schemas" (field schema, field detection bullets, fill output), FR-D11,
  §14 E13 (IoU ≥ 0.5, label match, owner match; recall ≥ 90%, precision ≥ 95%, informational).
- SV-Box forms in `data/svbox/Anträge und Formulare/` (fillable; good for the AcroForm path and as
  flattened test inputs). Read-only.
- `packages/evals` runner from WP-111 (`Suite`, `Case`, runner, stats). The gold set itself is
  WP-169; here a small fixture set proves the harness.
- Model access: AI SDK with `@ai-sdk/openai` (in brain baseline); model from `FORM_VISION_MODEL`.
  The model router (WP-006) may not exist yet; keep provider calls behind one function.

## Scope

In scope: AcroForm reader, text-layer and vector-graphics candidate detection with pdf.js, label
association, type inference, owner-section detection, vision fallback for scanned pages, confidence,
a `detectFields(pdfBytes, options)` API returning a draft `FormSchema`-shaped result, E13 suite
module, ADR.

Out of scope: the `form.analyze` tool wrapper and registry storage (WP-115), OCR on the Mac,
filling (WP-115), the E13 gold set (WP-169).

## Deliverables

1. **AcroForm path**: read fields with type, rect, page and name; map to the schema shape with
   `acro_field`; attach the nearest text label from the text layer.
2. **Flat path**: with pdf.js `getTextContent` and `getOperatorList`, find underscored runs,
   rectangles and small squares (checkboxes), combs, and dotted lines; associate each candidate with
   a label (left, above, or inside); infer type from label and shape (date patterns "TT.MM.JJJJ",
   "Datum", numbers, "Unterschrift"); assign confidence.
3. **Owner sections**: detect headers such as "Vom Arzt auszufüllen", "Von der Krankenanstalt
   auszufüllen", "Vom Versicherungsträger auszufüllen" (patterns as data in a JSON file in this
   module) and set `owner` for fields below until the next section.
4. **Scanned path**: pages without a text layer are rendered to an image (pdf.js with a canvas
   implementation only if available in the baseline; otherwise document the limitation and use the
   vision model on the page image produced by an allowed approach) and sent to the vision model
   with a structured-output schema for boxes, labels and types; mark `confidence` lower.
5. **E13 suite** (`packages/evals/src/e13/**`): suite definition and metrics (IoU matching, label
   and owner match, recall, precision), registered with the WP-111 runner, run on a fixture set of
   3 forms (flattened SV-Box forms with boxes derived from their AcroForm rects as gold).
6. **ADR 0120**: approach, thresholds, limits.

## Acceptance criteria

- [ ] AC1: For each of the 7 SV-Box fillable forms, the AcroForm path returns as many fields as
  the PDF has widgets, with correct types for checkboxes and text.
- [ ] AC2: On flattened copies of 3 SV-Box forms (flattened in the test with pdf-lib), the flat
  path reaches field recall ≥ 80% at IoU ≥ 0.5 against the original rects (E13 metric code).
- [ ] AC3: Owner sections: on the rehabilitation form, fields in the doctor section get
  `owner: doctor`.
- [ ] AC4 (live): a rasterized page sent through the vision path returns schema-valid fields.

## Notes for the implementer

- Use the pdf.js legacy build for Node; check its current ESM import path.
- Hospital and doctor sections must never be marked as applicant-owned.

## Suggested commits

- `feat(forms): read acroform fields with labels`
- `feat(forms): detect flat pdf fields from text and vector operators`
- `feat(forms): add owner sections and vision fallback`
- `feat(evals): add e13 field detection suite`
