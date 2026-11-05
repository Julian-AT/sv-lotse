# @lotse/knowledge

Repository data defines benefits, life situations, processes, offices, facilities and forms. The
brain reads the catalog from Postgres and uses the public EKO and fee loader exports.
Knowledge imports persistence from `@lotse/db` and `@lotse/db/schema`, never from brain.

The private SozDok snapshot is not tracked in git. Place the original XML files in
`<repository>/data/svbox/Rechtstexte/`, or set `SVBOX_DIR` to a directory containing `Rechtstexte/`.
Relative paths resolve from the repository root, including when running from this package.
Corpus-dependent tests skip with setup instructions if the files are absent; loaders and CLIs fail
with an actionable error. See the [SozDok loader](src/loaders/sozdok/README.md) for ingestion commands.

## Commands

Run from the repository root with Bun and Node.js 22+ installed:

| Command                                          | Purpose                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `bun run --filter @lotse/knowledge typecheck`    | Strict source and test type checks                                        |
| `bun run --filter @lotse/knowledge test`         | Schema, loader, scanner and dependency-direction tests                    |
| `bun run --filter @lotse/knowledge test:db`      | Real Postgres insert, idempotence, pruning and rollback tests             |
| `bun run --filter @lotse/knowledge catalog:load` | Validate repository records and synchronize Postgres                      |
| `bun run --filter @lotse/knowledge e2:scan`      | Validate data and scan brain/client sources for domain ids and stub flags |

Before database commands, run `docker compose up -d --wait` and
`bun run --filter @lotse/brain db:migrate`. Database entrypoints load `.env.local` without overriding
existing environment variables. The integration suite invokes the catalog CLI and uses a temporary schema with tables copied
from the migrated public schema, including constraints and indexes, and restores the process foreign
key. It cleans up that schema and never prunes the real catalog.

The catalog CLI accepts an optional package-root argument. The scan CLI accepts an optional repository
root. Neither command logs connection strings or record contents on failure.

## Authoring data

- `catalog/**/*.yaml` or `.yml`: one `Benefit` record per file ([format](catalog/README.md)).
- `processes/**/*.yaml` or `.yml`: one `Process` record per file ([format](processes/README.md)).
- `offices/**/*.yaml` or `.yml`: one `Office` record per file ([format](offices/README.md)).
- `facilities/**/*.yaml` or `.yml`: one `Facility` per file, described below.
- `forms/**/*.json`: one reviewed `FormSchema` per file ([format](forms/README.md)).
- Optional `allowlist.yaml`: `{ origins: [{ origin, purpose }], sources, as_of, verified_at? }`.
  Origins are HTTP(S) origins without paths, trailing slashes or credentials.
- Optional `sources.yaml`: `{ sources, as_of, verified_at? }`.

JSON is also accepted in all five record directories. YAML requires unique keys and known tags.
README files are ignored. Subdirectories are supported; symlinks are rejected. The package root must exist. Missing data
folders and missing registries are allowed during the initial data fan-out.

Every record has nonempty `sources`, with each source containing an HTTP(S) `url`, a nonblank,
verbatim `quote` and an ISO timestamp `retrieved_at`. Every record requires `as_of` (`YYYY-MM-DD`).
Benefits, offices, facilities and forms also require `verified_at` (the review date). Every object
schema is strict: unknown fields fail. Examples in documentation explain the format and are not
catalog content; replace their illustrative evidence with verified official quotes before curation.

Ids match `[a-z0-9][a-z0-9_.-]*` and are unique within their record kind. Source references are
embedded objects, so each criterion and attachment carries its own quote. References use
`ref:<kind>/<id>` for `catalog`, `processes`, `offices`, `facilities` or `forms`. Process steps can
use `ref:catalog/<id>#criteria` and `#documents`. Reference fields enforce their expected kind and
fragment. All links resolve after validation, including catalog/process cycles. A failure names
the file and dotted field path; a duplicate names both files and the `id` field.

```ts
import { loadKnowledge } from "@lotse/knowledge";

const knowledge = await loadKnowledge();
// Records remain JSON-compatible; dereference links without making cyclic objects.
// knowledge.resolve(reference) returns a frozen record or fragment.
```

`Knowledge` has deeply readonly, frozen maps `catalog`, `processes`, `offices`, `facilities` and
`forms`, optional registries, and a `resolve` function. Loading validates links; it does not evaluate
conditions or execute processes.

### Facilities

A facility has `id`, `name_de`, `type`, provenance and optional `region`, `address`, `location`,
`phone`, `email`, `url`, `appointment_channels` (URLs), `accessibility`, `services`, `carriers` and
an `office` ref. Address fields are `street`, `postal_code`, `locality`, `country: AT`; geographic
coordinates are latitude/longitude in degrees. Example:

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

### Database synchronization

`loadCatalog(database, knowledge)` uses the exported brain database client and one advisory-locked
transaction. Catalog ids map to database `key`; official names map to `title`, benefit areas to
`category`, and the complete records to JSONB `record`. A single benefit carrier maps to `carrier`;
multiple carriers stay in the JSON record and leave that column null. Processes store the linked
benefit's database UUID. Process titles use their stable id because the PRD defines no process title.

Unchanged records cause no UPDATE, preserving UUIDs, timestamps and row versions. Rows missing from
the snapshot are deleted, with processes removed before benefits. This is a complete repository
mirror, so the catalog command must target the intended environment. Reviewed form schemas update
only an existing template identified by `template_id`; no acquired template or form instance is
deleted, and no PDF asset is invented when a template is absent.

### E2 generalization scan

The scanner collects record ids plus catalog `life_situations` (scenario ids). It scans TS/JS sources
in `packages/{brain,guide,ui}/src` and `apps/web/src`, and Swift sources in `apps/mac`. Missing roots
are skipped. Generated and build directories are excluded. Comments and JS regular expressions are
ignored; escaped literals, templates, identifiers, Swift raw/multiline strings and interpolation
are scanned. Ids also match within literal paths and text at id boundaries.

`BRAIN_ALLOW_STUBS` references in these roots and TS/JS files under `scripts` fail unless the exact
repository-relative path is listed in `src/e2/config.ts`. The initial exception list is empty.
The scan also enforces the brain-to-knowledge import prohibition, including brain tests. Findings
report file, one-based token-start line, rule and id; the CLI exits nonzero.

Official API references: [Zod 4](https://zod.dev/api), [YAML 2](https://eemeli.org/yaml/),
[Postgres.js](https://github.com/porsager/postgres).

## Voice vocabulary

`data/voice-vocabulary.json` records catalog display spellings and carrier abbreviations with
source quotes and an `as_of` date. Recognition variants and German/English pronunciation
respellings are editorial aliases, not quotations from the cited sources. The public
`@lotse/knowledge/voice-vocabulary` module validates the data, limits recognition hints to 50
terms of 20 characters, and performs whole-term spelling/alias replacements without fuzzy edits.
Long catalog names remain available for spelling normalization even when excluded from hints.

After changing the data, run `bash apps/mac/Scripts/generate-voice-vocabulary.sh` from the
repository root. This generates the SwiftPM resource used by offline Apple recognition and
dictation. The knowledge unit tests verify that the bundled copy matches the source.
