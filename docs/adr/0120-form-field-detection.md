# ADR 0120: Draft PDF field detection and E13 measurement

- Status: detection approach accepted; E13 suite aggregation blocked on WP-111 contract change
- Date: 2026-11-05
- Requirements: PRD §10 form registry and schemas, FR-D11, §14 E13

## Context

Official forms include AcroForm widgets, printed answer boxes and scans. Detection must preserve
widget geometry, find missing fields, retain doctor/hospital/office sections and return a draft
for review. No existing frozen `FormSchema` contract is present in this baseline; database template
schemas are JSON records. Detection does not write to the registry, fill PDFs or submit forms.

## Decisions

### API and coordinates

`@lotse/brain/forms/detect` exports `detectFields(pdfBytes, options)`, the draft/field Zod schemas,
types and typed errors. The result is always `status: "auto"`, with page dimensions and fields:
`id`, `label_de`, `type`, `box`, optional `acro_field`, `owner`, `signature`, `confidence`, `method`.
Names and rectangles identify widgets separately even when one AcroForm field has several widgets.
The caller's bytes are copied before PDF.js can transfer its buffer to a worker.

Boxes are in points in the displayed CropBox, top-left origin, with one-based pages. The PDF.js
viewport transform accounts for crop offsets, rotation and user units. Normalize reversed widget
rectangles. Preserve zero-area widget rectangles if encountered; their IoU is zero. Candidate
boxes are clipped to the page. No coordinate conversion to pixels or PDF bottom-left coordinates
should be guessed by downstream callers.

The default `mode: "auto"` reads widgets and searches page content for missing fields, suppressing
candidates overlapping widgets at IoU >= 0.5. `mode: "acroform"` reads exactly the widgets and does
not invoke vision or infer additional fields. Text widgets retain type `text`; checkbox, radio,
choice and signature widgets retain their PDF type. AcroForm names remain available for writing.
Labels come from nearby printed text, then the alternative name, then the AcroForm name.

### Deterministic candidates

Use `pdfjs-dist` 6.5.438, the latest stable resolved for this work package, via
`pdfjs-dist/legacy/build/pdf.mjs`. This version requires Node >= 22.13.0. Its operator list packs
DrawOPS into `constructPath`; tests on real flattened PDFs protect this version-sensitive boundary.
Track graphics transforms, save/restore, nested Form XObjects and groups. Ignore live annotation
appearances and clipping-only paths. Closed rectangular paths and small squares produce candidates;
horizontal rules, dash segments, underscores and dotted text runs produce answer lines. Shared
upper/lower rule endpoints partition adjacent answer areas. Adjacent equal cells with gaps <= 2
points and at least three cells form one comb. Group from the leftmost cell in spatial order and
emit each cell once, independently of PDF drawing order. Curved paths are not interpreted as rectangles.

Rectangles need width/height >= 5 points and height <= 150. Squares with dimensions 5–24 points
and aspect ratio 0.7–1.4 are checkboxes. Rules use a 12-point answer height where no enclosing
geometry exists; paired rules are 8–45 points apart. Suppress duplicate candidates at IoU >= 0.65.
Require an associated label (left, above, inside; right for checkboxes), and exclude section-header
containers. Labels infer date, number and signature types; other candidates remain text.

Confidence is an explicit heuristic, not a calibrated probability: widgets 0.99, rectangles 0.85,
paired rules 0.75, underscored/dotted text 0.65, standalone rules 0.60, vision 0.60. The overlay and
review flow in later work packages must allow corrections regardless of confidence.

### Owner sections

Owner patterns live in `owner-patterns.json`, validated at module load, with no template identifiers
in code. Join nearby text fragments and up to three spatially adjacent, left-aligned lines to
recognize split or wrapped headers; normalize intervening whitespace before pattern matching.
A header owns following fields
until another explicit owner header, carrying across pages. A heading within 80 points of the page
top also owns running-header identifiers above it. This protects repeated identifiers on medical
pages from inheriting applicant ownership. `Ärztliche Stellungnahme` is an explicit doctor header;
`Erledigung des Versicherungsträgers` resets ownership to office. Doctor and hospital ownership
never reset implicitly at a page boundary. Only applicant signature fields get `signature: subject`.

### Scans and provider boundary

Pages without text use the vision fallback, including pages with partial widgets. `vision: "disabled"` is deterministic-only;
`vision: "always"` requests vision explicitly, still preserving widgets. Vision fields overlapping
widgets at IoU >= 0.5 update those widgets' ownership and recompute their signature flag before
duplicate suppression; widget geometry, identity, type and confidence are retained. Render with PDF.js's Node
canvas factory, supplied by its optional `@napi-rs/canvas` dependency, without a separate direct
canvas dependency. This optional renderer was available in the installed distribution and was
verified against real PDFs. If it is unavailable, fail with `render_unavailable`; the caller may
supply a real PNG `renderPage` adapter instead. No placeholder images or simulated services exist.

Rasterization is in memory, at most 2x and a 2000-pixel long edge. `detectVisionFields` is the only
provider function. It requires `OPENAI_API_KEY` and validates optional `FORM_VISION_MODEL` from the
environment. When unset, the model defaults to the vision-capable
[`gpt-4.1-mini`](https://developers.openai.com/api/docs/models/gpt-4.1-mini), matching the evals package;
set `FORM_VISION_MODEL` to a nonempty model name to override it. It uses AI SDK 7
`generateText` / `Output.object`. Output includes
normalized page boxes, literal labels, types, owners and the final section owner for continuation.
Zod checks bounds before converting to page points. The prompt treats the image as untrusted data
and restricts work to layout, preserving the PRD medical boundary. Raw provider errors and page
content are never logged or propagated. Provider calls have a 60-second deadline and no SDK retries.
Cancellation reaches PDF loading/rendering and the provider. Inputs are limited to 25 MiB, 100 pages,
10,000 output fields and 500 vision fields per page; workers/canvases are released after use.

### E13 harness

`packages/evals/src/e13/index.ts` supplies `createE13Suite` and `registerE13` for the WP-111 runner.
The host supplies source-backed gold fixtures and a detector adapter, so evals has no brain import
and the demonstration CLI registry is unchanged. The brain tests register and run three flattened
SV-Box forms. Tests read originals through `SVBOX_DIR`; pdf-lib independently extracts widget gold
rectangles before flattening in memory. Original challenge files are never modified.

Maximum bipartite matching ensures a detection and a gold box are each used at most once. A box
match requires the same page and IoU >= 0.5. Full matches additionally require exact owners and
labels normalized with NFKC, German case folding and punctuation/whitespace normalization. Expose
box-only recall/precision and label/owner agreement separately. Empty denominators produce zero.
The current WP-111 runner reports macro averages over forms and exposes no suite aggregation hook.
The current E13 per-form ratios and capped target attainment therefore do not implement the PRD's
field-level suite targets. Correct this after a runner contract change: sum matched, detected and
gold field counts across the selected forms, then compute recall, precision and target attainment
from those totals. Aggregate box, label and owner diagnostics from their counts as well. Both full
recall >= 0.90 and precision >= 0.95 must hold for the suite; the target is informational. Keep the
20-form minimum, so the three-form harness returns `insufficient_data`.

The requested WP-111 change is an optional `RegisteredSuite` metric reducer invoked once after all
selected cases finish, before gate evaluation. Preserve the existing mean reducer for other suites,
the reserved `passRate`, missing-coverage handling, error rejection and minimum-set verdicts. This
requires changes to the runner and its tests outside WP-120 ownership; no local runner workaround
is introduced. Required integration regressions are unequal-sized forms (19 matched single fields
and 100 missed fields must yield 19/119 recall) and passing aggregate targets despite individual
forms falling below target (99% suite recall and 100% precision must pass).

The small fixture set proves geometry and runner integration. Its field-name labels and initial
applicant owner annotations are explicitly unreviewed and are not the hand-labelled E13 gold set.
Low label/owner scores remain visible; WP-169 supplies reviewed labels, sections and flat gold.
The WP-120 acceptance floor is separately box recall >= 0.80 on each of the three flattened forms.

## Verification and limits

Offline tests cover all seven original fillable forms, three real flattened forms, doctor/office
sections in the rehabilitation form, partial AcroForms, rotated/cropped coordinates, combs, dotted
rules, text placeholders, owner continuation and E13 matching/runner semantics. Test-only layouts
exercise cases absent from the original source set. The live test rasterizes an original SV-Box
page, embeds it in an image-only PDF, then calls real OpenAI through the automatic fallback. The
live test uses the default vision model when `FORM_VISION_MODEL` is unset.

General flat-form precision remains below the future E13 target: table borders and decorative rules
can be candidates, labels can be ambiguous, and unlabelled/curved fields can be missed. Multicolumn
owner sections at the same vertical position require review. Page-wide owner propagation is a
conservative provider-ownership heuristic. PDFs with a misleading text layer or incomplete scan
OCR need explicit `vision: "always"`. The vision schema validates structure and page bounds, not
semantic correctness. These drafts remain `auto`; no assertion of verified templates or full E13
quality is made. XFA-only forms, registry caching, filling and overlay correction are separate WPs.

## References

- [PDF.js examples and viewport coordinates](https://mozilla.github.io/pdf.js/examples/)
- [Official Node rasterization example](https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.mjs)
- [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [AI SDK image input](https://ai-sdk.dev/docs/foundations/prompts#image-parts)
- [pdf-lib flattening](https://pdf-lib.js.org/docs/api/classes/pdfform#flatten)

Context7 was configured locally but its MCP tools were unavailable in this session and a direct
MCP request could not connect. Current official documentation and installed package types/source
were used instead.
