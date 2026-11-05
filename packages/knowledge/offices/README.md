# Office directory

One strict `Office` object per YAML/JSON file. Nested folders can group carrier and regional
records. Benefits select offices through `office_rules`; no application code embeds an office id.

Omit `verified_at` while awaiting human review; source quotes and `as_of` remain required. Agents
must not invent a human verification date. `catalog:load` reports the awaiting-review office count.
The example below awaits review and uses illustrative source text:

```yaml
id: example-office
name_de: Servicestelle
name_simple: Ihre Servicestelle
carrier: oegk
region: Wien
address:
  street: Beispielstraße 1
  postal_code: "1010"
  locality: Wien
  country: AT
phone: "+43123456"
url: https://example.org/office
jurisdiction: Anträge im angegebenen Zuständigkeitsgebiet
opening_hours:
  monday: "08:00–12:00 und 13:00–15:00"
  notes: "Nur nach Terminvereinbarung."
sources:
  - url: https://example.org/office
    quote: "Die Servicestelle informiert über die Antragstellung. Montag: 08:00–12:00 und 13:00–15:00. Nur nach Terminvereinbarung."
    retrieved_at: 2026-11-01T12:00:00Z
as_of: 2026-11-01
```

After approving the record, a reviewer adds their actual review date, for example:

```yaml
verified_at: 2026-11-02
```

Required: `id`, `name_de`, `sources`, `as_of`. Optional: `verified_at`, `name_simple`, `opening_hours`, `carrier`, `region`,
`address`, `phone`, `email`, `url`, `jurisdiction`, `location: { latitude, longitude }`,
`appointment_channels` (URLs), `accessibility` (description). Carriers use the same enum as the
catalog. Regional authorities need no carrier. Coordinates are geographic degrees; addresses
use country `AT`. `verified_at` records human review, independently of source retrieval time.
Review dates must be valid `YYYY-MM-DD` dates when present.

`opening_hours` is an object with optional `monday`, `tuesday`, `wednesday`, `thursday`, `friday`,
`saturday`, `sunday` and `notes` fields. Each supplied value is nonblank text quoted verbatim from
the source and covered by a quote in `sources`. Preserve split hours, closed days and appointment
restrictions as published. Omit unknown weekdays; absence does not mean closed. `notes` can stand
alone for offices that only publish a general restriction. Never infer hours from another office.
