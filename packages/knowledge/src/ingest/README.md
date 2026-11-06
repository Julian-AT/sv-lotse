# Public-source ingestion

Run from the repository root after `docker compose up -d --wait` and
`bun run --filter @lotse/brain db:migrate`:

```sh
bun run --filter @lotse/knowledge ingest --origin www.oegk.at --limit 1 --dry-run
bun run --filter @lotse/knowledge ingest --origin www.oegk.at --limit 1
bun run ingest:e3
bun run --filter @lotse/evals audit:e3 --out /tmp/e3-corpus.json
```

`--origin` accepts an exact origin or hostname as listed in `allowlist.yaml`.
Without it, the CLI processes all explicit seeds in `ingest-sources.yaml`;
`--limit` is a positive integer. There is no recursive link discovery or scheduler. Refresh
intervals are registry data for a later job. A dry run still fetches public pages
politely, but requires neither database credentials nor an OpenAI key.

`ingest:e3` reads only URLs from the E3 source manifest; it never indexes gold excerpts or
questions. Publisher, carrier, region and life situations come from the exact registered seed,
or the registered seed for that origin. Every URL passes the ordinary robots-aware fetch,
normalization, chunking, embedding and transactional index pipeline. The command attempts all
sources and exits nonzero if any source fails. Run it from any working directory through the
package script; manifest and environment paths resolve from the module. Repeated runs reuse
HTTP validators and matching content hashes. `audit:e3` separately checks strict passage
containment, URL coverage and current validity without changing the index.

The allowlist uses the shared knowledge schema: `origins` contains exact origins
and purposes; `sources`, `as_of` and `verified_at` provide registry provenance.
Ingestion additionally rejects duplicate origins. Pensionsversicherung seeds and
provenance use `https://www.pv.at`. The shared loader's `sources.yaml` remains
independent of ingestion seeds.

Indexing requires `DATABASE_URL` and `OPENAI_API_KEY`. `EMBEDDING_MODEL` defaults
to `text-embedding-3-small`; `OPENAI_MODEL_EMBEDDING` takes precedence over `EMBEDDING_MODEL`.
The provider must support 1536 dimensions. SDK calls
batch 32 texts, limit provider parallelism to one and retry transient failures
(including rate limits) up to four times. The provider boundary is `createEmbedder`.
The SDK references are [embedMany](https://ai-sdk.dev/docs/reference/ai-sdk-core/embed-many)
and [OpenAI embeddings](https://ai-sdk.dev/providers/ai-sdk-providers/openai#embedding-models).

Each origin has one serial request queue. Both robots and page redirects are
checked against exact origins, with at most five redirect hops. Robots 404/410
means no restrictions; other unsuccessful statuses stop ingestion. Requests have
a 20-second timeout, a five-MiB body limit, a descriptive crawler User-Agent and
a one-second delay after the preceding response completes (or a longer published
crawl delay). ETag and Last-Modified validators are scoped to the final URL.
Routing metadata or embedding model/dimension changes cause a fresh fetch even
when validators are available. Legacy records without embedding identity are
also re-embedded; a 304 cannot bypass this migration.

Normalization selects the main article, removes navigation, cookie controls and
scripts, and preserves headings, lists, links and Markdown tables. ARIA headings
become Markdown headings; accordion level-one headings stay beneath the native
page title. Form containers are unwrapped and their controls removed, preserving
article prose. Collapsed accordions retain their prose. Table captions are
normalized with their tables and stay in the same indivisible chunk. Merged
table cells expand to a grid with shared values repeated across their spans; row spans stop at the
row-group boundary. Multiple header rows combine into column heading paths.
Overlapping spans fail explicitly rather than changing facts.
Only validity metadata in the document head or standalone `Gültig ab/von/bis`
labels in the main page preamble (before subsections) establish global
validity, including labels inside neutral layout wrappers. Heading subsections
and semantic `section`/`article` containers carry independent validity through
normalization and enrichment to each indexed chunk. Child scopes inherit and
may narrow parent intervals; sibling scopes do not share local dates. Section
labels remain quoted text, with global validity unset unless page-level dates
are also present. Publication/update timestamps do not establish validity.
Unknown validity remains null. Date-only
values use midnight UTC; the database interval is stored exactly as stated.

Searchable ingestion uses rendered link labels and emphasis text without Markdown decoration,
link targets or list bullets interrupting verbatim quotations. Direct `normalizeHtml` callers
retain the original Markdown behavior unless they request `{ searchable: true }`.

Chunking estimates one token per four JavaScript string characters, targeting
1600–3200 characters including heading prefixes. Every heading starts a new
section and each chunk includes its parent heading path. Paragraph splits retain up to
800 characters of overlap at word boundaries within the same heading and validity scope.
Tables remain independent and never contribute partial overlap. Small sections and
section remainders carry `size_exception: section_tail`; indivisible tables over
the upper bound carry `oversized_table`. No chunk crosses a top-level section.

PDFs are explicitly unsupported because the baseline packages have no PDF
text-layer extractor. The fetcher returns a structured `not_supported` record
with reason `pdf_text_extraction_unavailable`, and the CLI reports it without
writing a source or calling the model. A future extractor can replace that branch
without pretending that pdf-lib extracts text.

The source record stores normalized Markdown in `text` and raw HTML plus HTTP
validators in `metadata`. Its SHA-256 hash covers normalized content, title,
publisher, language, routing metadata, validity and normalized section scopes.
Scope-only changes therefore also cause reindexing. The chunking configuration and representation
version are hashed too; a changed pipeline signature disables old HTTP validators so a 304 cannot
hide a needed normalization/chunking upgrade. Source and chunk metadata
also store `embedding: { model, dimensions }`, taken from the embedder's immutable
identity. Only matching hashes AND embedding identities skip writes and calls.
Changed sources replace all their chunks within one transaction. A model change
re-embeds incompatible stored chunks across the corpus in batches of 32 within
that same transaction. Failure rolls back every vector and metadata change;
readers see either the old or the new vector space. This deliberately makes model
changes a potentially long, corpus-wide operation. All ingestion writers take a
global embedding advisory lock before the per-URL lock to serialize migration
and prevent mixed-model indexes. Retrieval must additionally filter chunk
`metadata.embedding` by its query embedder's identity, so an older query process
cannot compare its vectors with a newly migrated index. This provides ingestion upsert
semantics without changing the frozen schema, which has no unique URL index.
Ambiguous preexisting duplicate URLs fail explicitly. All writers of ingested
sources must use this entrypoint to participate in the lock.

Tests:

```sh
bun run --filter @lotse/knowledge test
bun run --filter @lotse/knowledge test:db
RUN_LIVE=1 bun run --filter @lotse/knowledge test:live
```

Unit tests use a real local HTTP server and an immutable saved ÖGK page. Database
tests use real Postgres tables cloned from the migrated schema in an isolated,
temporary schema, and deterministic embeddings confined to the test file.
The live test fetches one official seed and uses real OpenAI embeddings for both
indexing and the search query; it retains the indexed official source for reuse.
No custom German Postgres dictionary is installed: `synonyms.yaml` is validated
for query-time use by retrieval.

## Pilot corpus

`bun run --filter @lotse/knowledge ingest:pilot [--on YYYY-MM-DD] [--dry-run]` reads the data-only
`ingest-pilot.yaml` manifest. It fetches six reviewed official rehabilitation, care and prescription-fee
pages through the existing allowlist/robots/rate-limited fetcher, then loads the listed SozDok
provisions effective on the requested date. Full version history determines exclusive validity ends;
only the selected provisions are embedded and indexed. Original SV-Box XML stays read-only and is
resolved using the loader's existing `SVBOX_DIR` handling.

The dry run fetches/normalizes the six pages without database writes or provider calls. Full ingestion
requires migrated Postgres and OpenAI credentials. It writes only fixed status/count/origin logs,
closes its database connection, and exits nonzero on any failed page. Re-runs use existing content
hashes/validators. SozDok chunks and sources carry the same embedding identity as page chunks.
`OPENAI_MODEL_EMBEDDING` takes precedence over the legacy `EMBEDDING_MODEL`; blank overrides are ignored.
The default is `text-embedding-3-small`, 1536 dimensions, matching brain retrieval.

The 2026-11-06 live run indexed all six pages and ten currently valid legal sources/chunks. Some
manifest provisions have no effective entry in the challenge snapshot; no missing law text is invented.
Legal citations retain the loader's stable `sozdok://` document identifiers and paragraph/version titles.
Undated web pages use the indexing date for the frozen nonnullable Passage `validFrom` transport field;
this is not a claim that a legal rule commenced on that date. Source/chunk validity, when available,
always takes precedence.
