# Reviewed form schemas

One strict `FormSchema` per JSON file. Acquired `auto` schemas stay in the database; repository
schemas require `status: verified`, source quotes, `as_of` and `verified_at`.

```json
{
  "id": "example-form",
  "template_id": "b508cc7c-bfb0-4f73-893d-ae85a8e73c56",
  "status": "verified",
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
  "as_of": "2026-11-01",
  "verified_at": "2026-11-02"
}
```

`id` is the stable catalog reference id. `template_id` is the UUID of the existing, acquired
`form_template` version whose schema is reviewed; obtain it from the registry. Catalog loading
updates that template's `schema` and `status` only when it exists. It never creates a template
without an original asset, or removes templates or form instances.

Each field requires every PRD field except the alternative location: provide exactly one
`acro_field` or `box: { page, x, y, width, height }`. Page numbers are one-based; rectangles use PDF
points in the source page coordinate system. Field ids are unique per form. `type` is `text`,
`date`, `number`, `checkbox`, `choice` or `signature`; `owner` is `applicant`, `doctor`, `hospital`
or `office`; `signature` is `subject` or `none`. `labels` is a locale-to-label map.
`validation` supports `required`, `min`, `max`, `min_length`, `max_length`, `pattern`, `options`.
Mappings preserve ownership so the form engine can leave doctor, hospital and office sections
untouched. A schema is administrative metadata and must never contain inferred medical advice.
