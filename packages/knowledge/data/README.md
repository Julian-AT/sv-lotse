# Directory support data

`postcodes-at.json` bundles all 2,501 postal codes in the Austrian GeoNames postal
export retrieved on 2026-11-06. It requires no geocoding service at runtime.
[Download](https://download.geonames.org/export/zip/AT.zip),
[format and licence](https://download.geonames.org/export/zip/readme.txt).
Attribution: GeoNames, CC BY 4.0, https://www.geonames.org/.

Each postcode stores the arithmetic mean of the export's locality coordinates,
all locality names and all region names. This is an approximate postal-area
centroid, not an address or an official administrative boundary. Shared postcodes
can span multiple municipalities or states. Named-place matching accepts locality
names and the city part before a comma; distant homonyms require a postcode.
Distances are Haversine straight-line estimates, never driving distances.

`office-context.json` maps the tool's carrier, region and subject status fields
to slot names used by the catalog. It also defines explicit pension source
mappings and the administrative fact types allowed in appointment drafts.
A pensioner whose pension carrier is unknown must clarify it; an ÖGK health
insurance record does not imply a pension carrier. Office references and
jurisdiction conditions remain in the benefit catalog, rather than in this file
or in application code.
