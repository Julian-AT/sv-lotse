# Benefit catalog

One strict `Benefit` object per YAML/JSON file; nested folders are allowed. See
[`../README.md`](../README.md) for provenance, ids and links. All table fields in PRD §10 are
represented. Carriers are `oegk`, `svs`, `bvaeb`, `pva`, `auva`; scope is `social_insurance`,
`federal`, `state`, `municipality` or `other`; area is A–F. An empty forms array represents no
applicable form; a search hint supports acquisition without a registered template.

Records without `verified_at` await human review. Agents supply source quotes and `as_of`, never
an invented review date. A reviewer adds `verified_at: YYYY-MM-DD` only after approving the record;
the date is independent of source retrieval time. Malformed dates are rejected.

Illustrative awaiting-review example (linked records must also exist):

```yaml
id: example-benefit
name_de: Antrag auf Unterstützung
name_simple: Unterstützung beantragen
area: F
life_situations: [example-situation]
scope: other
carriers: []
criteria:
  - id: residence
    text_de: Ein Wohnsitznachweis ist erforderlich.
    condition: residence.confirmed == true
    legal_basis: Veröffentlichte Antragsbedingungen
    source: &source
      url: https://example.org/application
      quote: Ein Wohnsitznachweis ist erforderlich.
      retrieved_at: 2026-11-01T12:00:00Z
office_rules:
  - when: residence.confirmed
    office: ref:offices/example-office
documents:
  - id: residence-proof
    name_de: Wohnsitznachweis
    required: true
    obtain_from: Zuständige Meldebehörde
    source: *source
forms:
  - search: Antrag auf Unterstützung
    publisher: Zuständige Stelle
process: ref:processes/example-process
appointment_channels: []
sources: [*source]
as_of: 2026-11-01
```

For a reviewed version of the same example, a human reviewer adds their actual review date:

```yaml
verified_at: 2026-11-02
```

`loadKnowledge().awaitingReview` and the `catalog:load` console summary count records without
`verified_at` separately for `catalog`, `processes`, `offices`, `facilities` and `forms`.

Criteria require `id`, `text_de` and `source`; `condition` and `legal_basis` are optional. Condition
syntax is documented in the process folder. Documents require `obtain_from` even when optional.
Booking channels are `online` with `url`, `phone` with `number`, or `email` with a `mailto:` `url`; each has
`verified_at`. Known online booking pages must be on the reviewed allowlist.

Prevention records may include `target_group` with optional `age_min`, `age_max`, `sex`
(`female`, `male`, `diverse`, `all`), `interval`, `family_history_criteria`, and required
`rationale_text`, `rationale_source`. They describe published administrative program criteria;
never infer medical suitability, diagnoses or personal risk.
