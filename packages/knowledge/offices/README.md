# Office directory

One strict `Office` object per YAML/JSON file. Nested folders can group carrier and regional
records. Benefits select offices through `office_rules`; no application code embeds an office id.

```yaml
id: example-office
name_de: Servicestelle
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
sources:
  - url: https://example.org/office
    quote: Die Servicestelle informiert über die Antragstellung.
    retrieved_at: 2026-11-01T12:00:00Z
as_of: 2026-11-01
verified_at: 2026-11-02
```

Required: `id`, `name_de`, `sources`, `as_of`, `verified_at`. Optional: `carrier`, `region`,
`address`, `phone`, `email`, `url`, `jurisdiction`, `location: { latitude, longitude }`,
`appointment_channels` (URLs), `accessibility` (description). Carriers use the same enum as the
catalog. Regional authorities need no carrier. Coordinates are geographic degrees; addresses
use country `AT`. `verified_at` records human review, independently of source retrieval time.
