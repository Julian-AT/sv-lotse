# Facility directory

One strict `Facility` object per YAML/JSON file; nested folders are allowed. See
[`../README.md`](../README.md) for provenance, ids and links.

Omit `verified_at` while awaiting human review; source quotes and `as_of` remain required. Agents
must not invent a review date. `catalog:load` reports the awaiting-review facility count.

Illustrative awaiting-review example:

```yaml
id: example-facility
name_de: Beratungszentrum
type: counselling
region: Wien
services: [Beratung zur Antragstellung]
sources:
  - url: https://example.org/facility
    quote: Beratung zur Antragstellung ist nach Vereinbarung möglich.
    retrieved_at: 2026-11-01T12:00:00Z
as_of: 2026-11-01
```

After approving the record, a reviewer adds their actual review date, for example:

```yaml
verified_at: 2026-11-02
```

Required: `id`, `name_de`, `type`, `sources`, `as_of`. Optional: `verified_at`, `region`,
`address`, `location`, `phone`, `email`, `url`, `appointment_channels` (URLs), `accessibility`
(description), `services` (strings), `carriers` and `office` (`ref:offices/<id>`; the linked
office must exist). Carriers are `oegk`, `svs`, `bvaeb`, `pva`, `auva`.

Addresses contain `street`, `postal_code`, `locality` and `country: AT`. Locations contain
`latitude` and `longitude` in geographic degrees. `type` is a nonblank string describing the
facility category. `verified_at` records human review, independently of source retrieval time.
Review dates must be valid `YYYY-MM-DD` dates when present.
Replace the example's illustrative evidence with verified official quotes before curation.
