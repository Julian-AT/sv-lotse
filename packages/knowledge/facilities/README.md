# Facility directory

One strict `Facility` object per YAML/JSON file; nested folders are allowed. See
[`../README.md`](../README.md) for provenance, ids and links.

Illustrative authoring example:

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
verified_at: 2026-11-02
```

Required: `id`, `name_de`, `type`, `sources`, `as_of`, `verified_at`. Optional: `region`,
`address`, `location`, `phone`, `email`, `url`, `appointment_channels` (URLs), `accessibility`
(description), `services` (strings), `carriers` and `office` (`ref:offices/<id>`; the linked
office must exist). Carriers are `oegk`, `svs`, `bvaeb`, `pva`, `auva`.

Addresses contain `street`, `postal_code`, `locality` and `country: AT`. Locations contain
`latitude` and `longitude` in geographic degrees. `type` is a nonblank string describing the
facility category. `verified_at` records human review, independently of source retrieval time.
Replace the example's illustrative evidence with verified official quotes before curation.
