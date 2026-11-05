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
(description), `opening_hours` (source-quoted text), `services` (strings), `carriers` and `office` (`ref:offices/<id>`; the linked
office must exist). Carriers are `oegk`, `svs`, `bvaeb`, `pva`, `auva`.

Addresses contain `street`, `postal_code`, `locality` and `country: AT`. Locations contain
`latitude` and `longitude` in geographic degrees. `type` is a nonblank string describing the
facility category. `verified_at` records human review, independently of source retrieval time.
Review dates must be valid `YYYY-MM-DD` dates when present.
Replace the example's illustrative evidence with verified official quotes before curation.

## Sourced regional records

The directory contains two rehabilitation contacts each in Styria (PV ZAR Graz,
PV St. Radegund) and Vienna (Wien Baumgarten, PV ZAR Wien), plus FSW care advice in
Vienna. Contact details and opening hours, where published, come from the linked
provider pages. They describe administrative contacts, not suitability or medical
recommendations. Records await human review; no `verified_at` date is invented.

Coordinates for Wien Baumgarten, St. Radegund and FSW come from the providers'
embedded maps. ZAR Graz and ZAR Wien use approximate address points from
OpenStreetMap, linked in their `sources`; © OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright). An address point is not necessarily
a particular entrance. Opening hours do not establish slot availability, and
unpublished language or accessibility details remain unknown.

Facilities may include `opening_hours` (weekday keys and published time intervals),
`languages` (language codes) and `accessibility_features` (explicitly verified feature
names). Omit unknown properties. A website accessibility statement is not evidence
of physical step-free access. General provider URLs are not booking channels;
only `appointment_channels` URLs on the shared allowlist can be returned as online
appointment options.

## Mobile care, checkups and remote advice

The `mobile/` and `prevention/` records add Vienna and Graz contacts from the FSW
recognized-provider directory, the City of Graz's district directory, the City of
Vienna and the Austrian social-insurance directory. Each record carries its
retrieval date. FSW's directory identifies its mobile-care provider at Guglgasse;
the location is the shared administrative address, not a home-care visit location.
Graz's mobile-care directory lists district responsibilities; users must confirm
coverage for their own address. Its unpublished coordinates remain unknown.

Checkup coordinates come from Vienna's official address service (EPSG:31256,
converted to WGS84 with PROJ) and the ÖGK's public location directory. Telephone
appointment hours for the Vienna checkup service are contact hours, not examination
or appointment availability. No online booking URL or accessibility/language claim
has been inferred. These records await human review.

`advice/` contains a nationwide telephone contact from the federal health portal.
`remote: true` explicitly marks contacts that appointment search may return without
a physical location or a distance. It does not infer this from a name or phone
number. Advice contacts remain telephone channels in the existing tool contract.
After changing directory data, synchronize it with `catalog:load` in the target
environment; the workspace and appointment tools read the persisted catalog.
