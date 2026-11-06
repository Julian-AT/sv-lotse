# E7 — SV-Box prefill gold, version 1

Seven original PDFs, three synthetic personas per form, and an explicit expected scalar or `null`
for **every native field**. `forms.json` pins the read-only originals by SHA-256 and identifies
their candidate schemas in `packages/knowledge/forms`. No original PDF is rewritten or copied.
The source of field identity is the PDF's AcroForm; its printed sections determine ownership.
Publisher URLs identify the issuer, not a claim of a fresh official download. The source asset
and its hash are the precise provenance. These are agent-authored candidate mappings, **not human
verification**; `status: auto` is intentional.

The AcroForms contain 416 unique native fields (widget counts and the PRD inventory can differ).
Repeated widgets sharing one native name count once. Shared values that also occur in a provider
section stay protected everywhere; for example, a repeated insurance-number widget in the
rehabilitation application cannot safely be filled only on the applicant page. The accident
rehabilitation form is hospital-owned in its entirety, including its administrative identifiers.

`gold.json` stores the inputs and expected outputs separately. The adapter receives persona facts
and the form reference; it never uses expected values to create proposals. Every supplied fact has
an explicit synthetic quote and confirmation. Each case inserts real user/session/subject/case/actor,
turn, document metadata and fact rows into an isolated migrated Postgres database. Extra unconfirmed
and foreign-subject name facts test isolation. No document asset/OCR is required for a statement
fact: the document-only IBAN is a deliberately synthetic, confirmed metadata fixture.

The personas vary names/diacritics, age, carrier, city, contact information and representation:

- Persona 1 states an IBAN and asks to be contacted directly.
- Persona 2 supplies no IBAN, omits email/optional facts, and has a leading-zero insurance number.
- Persona 3 supplies an IBAN **only in a document**, so it must remain empty; a contact delegate is
  explicitly named. The title and accented given name exercise string preservation.

All doctor, hospital, office and signature values are `null`. Unknown applicant facts, unprovided
insured-relative details and clinical sections also have explicit `null` gold. Opaque, multi-widget
checkbox groups with several PDF export states are not guessed from a boolean or translated into
medical decisions. They remain unmapped/missing until an independently reviewed export-state
mapping exists. A `form.field.<template UUID>.<field id>` fact type is an explicit unresolved
field-specific slot, **not a claimed semantic mapping**. Administrative native text fields retain
their string representation, including dates and leading zeros. Radio-group values in the travel
form use its literal export options; no semantic travel-option conversion is claimed.

Scoring pools field counts, not per-form percentages. Exact equality preserves scalar type.
Normalized equality applies Unicode NFKC and whitespace normalization to strings only. The 95%
informational target uses the **218 expected nonempty values**; the 1,030 expected blanks are scored
separately and cannot inflate prefill accuracy. A hospital-only case contributes zero positive fields.
Unexpected proposals, incorrect blanks, provenance errors, incorrect missing-field reporting and
draft-persistence errors fail the case. The harness's 21-case minimum cannot be met with a subset.
Human review, clinical/checkbox export-state completeness, approval execution and PDF rendering are
outside this measured E7 score; existing brain lifecycle tests exercise approvals/rendering separately.

Run from the repository root (or via the workspace filter from a package directory):

```sh
bun run evals --suite E7 --out docs/evals/artifacts/e7/summary.json
bun run --filter @lotse/evals test
bun run --filter @lotse/brain test:forms:integration
```

The CLI loads root `.env.local` without overwriting exported values. Postgres must allow `CREATEDB`;
the suite migrates and drops a unique database. `SVBOX_DIR` may be absolute or root-relative.
No OpenAI, external download or MinIO calls are needed by E7. The separate lifecycle regression
suite requires real MinIO. Exported E7 artifacts contain counts and opaque case IDs, never fact values.
