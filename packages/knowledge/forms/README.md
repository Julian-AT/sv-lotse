# Form schemas and review state

The seven `svbox-*.json` candidates preserve all 416 unique native fields of the original challenge
PDFs. Their exact asset paths and SHA-256 hashes, three synthetic personas per form and independently
stored gold values are in `packages/evals/sets/e7/`. These candidates have not been human verified.
Unmapped field-specific fact types remain missing rather than inventing values or checkbox meanings.
The E7 adapter registers the original assets only in its disposable database; catalog loading still
updates existing acquired templates and never fabricates an asset. Repeated widgets that share a
value with a provider section remain protected across the whole native field. The sourced applicant
declaration boundary used after provider confirmations is in `data/form-owner-declarations.json`.

One strict `FormSchema` per JSON file. Repository schemas may be candidates awaiting review
(`status: auto`, no `verified_at`) or reviewed schemas (`status: verified`, required `verified_at`).
Both states require source quotes and `as_of`. Agents must not invent a human verification date;
review dates must be valid `YYYY-MM-DD` dates. `auto` schemas with a review date and `verified`
schemas without one are rejected. `catalog:load` reports the number of forms awaiting review.

Illustrative candidate awaiting review:

```json
{
  "id": "example-form",
  "template_id": "b508cc7c-bfb0-4f73-893d-ae85a8e73c56",
  "status": "auto",
  "fields": [
    {
      "id": "applicant-name",
      "label_de": "Name",
      "labels": { "en": "Name" },
      "help_text": "Name der antragstellenden Person",
      "type": "text",
      "validation": { "required": true },
      "fact_type": "person.name",
      "acro_field": "Name",
      "owner": "applicant",
      "signature": "none"
    }
  ],
  "sources": [
    {
      "url": "https://example.org/form.pdf",
      "quote": "Name der antragstellenden Person",
      "retrieved_at": "2026-11-01T12:00:00Z"
    }
  ],
  "as_of": "2026-11-01"
}
```

After approving the schema, a human reviewer changes `status` and adds their actual review date.
For a reviewed version of the example, replace its review-state fields with:

```json
{
  "status": "verified",
  "verified_at": "2026-11-02"
}
```

`id` is the stable catalog reference id. `template_id` is the UUID of the existing, acquired
`form_template` version whose schema is recorded; obtain it from the registry. Catalog loading
updates that template's `schema` and preserves the file's declared `status` only when it exists.
It never promotes candidates automatically or creates a template
without an original asset, or removes templates or form instances.

Each field requires every PRD field except the alternative location: provide exactly one
`acro_field` or `box: { page, x, y, width, height }`. Page numbers are one-based; rectangles use PDF
points in the source page coordinate system. Field ids are unique per form. `type` is `text`,
`date`, `number`, `checkbox`, `choice` or `signature`; `owner` is `applicant`, `doctor`, `hospital`
or `office`; `signature` is `subject` or `none`. `labels` is a locale-to-label map.
`validation` supports `required`, `min`, `max`, `min_length`, `max_length`, `pattern`, `options`.
Mappings preserve ownership so the form engine can leave doctor, hospital and office sections
untouched. A schema is administrative metadata and must never contain inferred medical advice.
