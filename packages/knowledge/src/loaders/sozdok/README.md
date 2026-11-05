# SozDok loader

The SV-Box snapshot contains 14,244 XML provision versions. The loader reads the original files
without modifying them, preserves German text and inline references, and stores legal-basis sources.
It does not call an embedding service.

From the repository root:

```sh
docker compose up -d --wait
bun run --filter @lotse/brain db:migrate
bun run --filter @lotse/knowledge sozdok:load
bun run --filter @lotse/knowledge sozdok:load --on 2026-01-01
bun run --filter @lotse/knowledge typecheck
bun run --filter @lotse/knowledge test
bun run --filter @lotse/knowledge test:db
```

The CLI loads `.env.local` without overriding existing environment variables. `DATABASE_URL` is
validated by the brain database client. `SVBOX_DIR` points to the SV-Box root; relative paths resolve
from the repository root, including when Bun runs the script from the package directory. The default
is `data/svbox/`. XML files live in its `Rechtstexte/` subdirectory. To load a copied subset directly,
pass `--directory /absolute/path/to/xml-folder`.

Without `--on`, all versions are loaded. With `--on YYYY-MM-DD`, each provision contributes only its
version in force on that date; provisions with no earlier version contribute nothing. Validity is
derived from incoming and persisted history before filtering. End dates are exclusive, so the
older version stops being valid on the day the next one begins. Partial directories also reconcile
persisted predecessors and preserve known end dates, including successors seen in previous input
but excluded from insertion by `--on`. Each provision's known start and end dates are reconciled
together, so a newly discovered intermediate version inherits the next known transition even
when that successor exists only as a persisted end date. Validity changes invalidate affected chunks
in the same transaction. Existing historical sources remain in the database. The snapshot cannot reveal
repeals or versions absent from its files; versions with no known successor have an open end.

## Library use

The public entrypoint is `@lotse/knowledge/loaders/sozdok`:

```ts
import { sozdokChunks } from "@lotse/knowledge/loaders/sozdok";

const chunks = await sozdokChunks({ on: "2026-01-01" });
// Pass each chunk's text, URL, citation and metadata to the WP-103 indexer.
```

`parseSozdok(xml, file)` returns the normalized record, including `paragraph: { gldnr, gldsym }`,
`gldart`, publication references and ordered `absatz` units. Structural failures throw
`SozdokParseError` with the file name. Optional publication/decision dates, publisher, headings,
symbols and visibility remain `null` when absent. Ten real files omit `gldart`; the loader recovers
it from `dokid`. Blank provision numbers in unnumbered annexes remain blank. Provision grouping
uses `(law_abbr, gldart, gldnr)` and rejects conflicting versions with the same start date.

`groupVersions(records)` derives validity and `inForceOn(versions, date)` selects within one such
group. `chunkSozdok(version, maxTokens?)` emits one chunk for short provisions, splitting larger
ones only before a complete `absatz`. Following lists stay with their preceding absatz. Tables
expose their inner absatz boundaries and preferred row ranges (`table_rows`); chunking keeps a row
together when it fits the budget, otherwise splits at its absatz boundaries. The approximate default
budget is 1,500 tokens at four Unicode characters per token. An individual oversized absatz stays whole even when
it exceeds the budget. Multi-provision files retain `provision_ranges` with exclusive offsets into
`absatz`, derived from XML `gldsym` paragraph and article markers. Chunking flushes at these boundaries,
including inside tables, and uses each provision's number, symbol and kind in metadata and citations.
An unnumbered preamble stays with the first provision; trailing material stays with the last.
Single-provision records retain their original file-level identity. Chunks never combine provisions.
Their text joins back to the record text without loss. Footnote references use `[<number>]`, and their bodies retain the same numbered
labels so reference numbers cannot merge with dates or other legal text. Embedded body markers
take precedence over `fntext.nr`; bodies without a marker use `nr` as their label. Paragraph citations use
`§ <number> <law> (SozDok, in Kraft seit DD.MM.YYYY)`; articles use `Art.` and other provision kinds
retain their original `gldart` label.

`loadSozdok(database, options?)` uses a database created through `@lotse/brain/db`. It upserts one
source per document version at `sozdok://<dokid>`, with UTC-midnight validity, citation, publication
metadata and a SHA-256 content hash. Stable namespaced UUIDs and one namespaced transaction lock make reruns,
including concurrent ones, idempotent without a schema change. A load commits atomically. The CLI
reports source and chunk counts as JSON and never emits SQL errors or connection details.

By default no `kb_chunk` rows are inserted because the schema requires an embedding. WP-103 can
consume `sozdokChunks(options)` independently, or supply an `embed(chunk)` callback to `loadSozdok`.
Supplied vectors must have the schema's dimension (currently 1,536), finite values and a nonzero
component. They are all validated before writes begin. Supplied embeddings replace that source's
chunks atomically. Source-only reloads preserve unchanged chunks and delete stale chunks if text or
validity, citation or chunk metadata changes, ready for reindexing. Source metadata includes the
provision ranges so source-only reloads also invalidate chunks indexed before boundary tracking.
No fabricated or zero embeddings are used in product code.

## Verification

The unit/corpus suite reads all real files, times parsing against the 60-second limit, checks every
provision's single-version resolution, reconstructs all text from chunks and checks five literal
citations. Its version-history fixture changes only a real file's in-force date and text because
the snapshot contains no history. Real-file regressions cover the large contract table and the
Canada agreement's dates and numbered footnotes, plus Israel Article 3's embedded footnote labels.
The multi-paragraph family hospice agreement is checked independently against its XML markers:
§§ 1–4 remain separate with their own citations at both default and smaller token budgets.
The database suite copies a real file into a
temporary folder, adds a derived version, invokes the actual CLI, and checks repeated/concurrent loads, date
filtering (including superseded-version validity), source updates and chunk invalidation against
real Postgres. Both copied versions receive unique test-only document IDs; cleanup deletes only
that test run's sources. A full-corpus database regression namespaces document IDs and law
abbreviations in temporary copies of all 14,244 files, then loads and date-filtered reloads them
with Compose's default lock settings. Subset regressions cover older-only reloads, newer-only
additions and metadata-only citation corrections. Embedding persistence tests supply constructed
vectors; no embedding provider belongs to this WP. A three-version regression first date-filters
the 1996/2010 history, then loads only the intermediate 2005 version and verifies its retained 2010
end in sources, indexed chunks and date-filtered queries.

Parser behavior follows the official
[fast-xml-parser options](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/docs/v4%2C%20v5/2.XMLparseOptions.md),
using order preservation and explicit attributes. DTD/entity declarations are rejected; UTF-8
characters, standard XML entities and SozDok's spacing elements are preserved in text normalization.
