---
id: WP-103
title: Ingestion pipeline with crawl, normalize, chunk, embed and index
wave: W1
lane: knowledge
risk: normal
codex_effort: high
depends_on: [WP-004]
fr: [NFR-15, E3]
owns:
  - packages/knowledge/src/ingest/**
  - packages/knowledge/test/ingest/**
  - packages/knowledge/allowlist.yaml
  - packages/knowledge/sources.yaml
  - packages/knowledge/synonyms.yaml
may_touch:
  - packages/knowledge/package.json
  - bun.lock
allow_deps: "`@lotse/brain` as `workspace:*` (only `./db`, `./db/schema`); `ai` and `@ai-sdk/openai` (brain's versions)"
live_services: [openai]
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test
  - bun run --filter @lotse/knowledge test:db
  - RUN_LIVE=1 bun run --filter @lotse/knowledge test:live
pr_title: "feat(knowledge): add ingestion pipeline into pgvector"
---

# WP-103: Ingestion pipeline with crawl, normalize, chunk, embed and index

## Goal

Allowlisted public sources become searchable knowledge-base chunks in Postgres: fetched politely,
normalized to Markdown, chunked along headings, enriched with metadata, embedded and indexed in
pgvector and German full-text search, with change detection by hash. Retrieval (WP-104) and E3
build on these chunks.

## Context

- PRD §10 "Source registry" (sites and refresh), "Ingestion pipeline" steps 1–7, "Retrieval"
  (needs carrier, region, validity metadata), synonyms note; NFR-15 (no custom Postgres
  dictionaries); §9 guide runtime uses the same allowlist (`packages/knowledge/allowlist.yaml`).
- Database (WP-004): `source` (url, title, publisher, text, metadata, valid_from, valid_to) and
  `kb_chunk` (source_id, text, embedding vector(1536), metadata, validity, generated German `tsv`).
- Baseline deps in `@lotse/knowledge`: `cheerio`, `turndown`, `robots-parser`, `p-limit`, `yaml`, `zod`.
- Dependency direction: knowledge may import `@lotse/brain/db*`; the brain never imports knowledge.
- WP-101 runs in parallel and owns `src/schemas/**` and `src/loader/**`. Define the allowlist and
  source-list schemas you need inside `src/ingest/` for now; WP-101 may consolidate later.

## Scope

In scope: allowlist and source list files with real entries from the PRD source registry,
fetcher (robots.txt, rate limit, conditional requests, allowlist enforcement), HTML and PDF-text
normalization to Markdown, heading-based chunker, metadata enrichment, embedding client, indexer
with hash-based change detection, `ingest` CLI, synonym list file.

Out of scope: SozDok and other SV-Box loaders (WP-166 and W1b), retrieval and reranking (WP-104),
catalog extraction agents, scheduling (a later job WP).

## Deliverables

1. **`allowlist.yaml`**: origins from the PRD source registry (oegk.at, svs.at, bvaeb.at, pva.at,
   sozialversicherung.at, sozialversicherung.gv.at, sozdok.at, gesundheit.gv.at, oesterreich.gv.at,
   sozialministerium.gv.at, sozialministeriumservice.gv.at, bmf.gv.at, fsw.at, aekwien.at,
   bewegt-im-park.at) with purpose and `verified_at`. **`sources.yaml`**: seed URLs per origin with
   refresh interval, carrier, region and life-situation tags.
2. **Fetcher**: only allowlisted origins (redirects re-checked), robots.txt respected, per-origin
   concurrency 1 and a delay, a descriptive User-Agent, ETag/Last-Modified conditional requests,
   timeouts, size limit, HTML and PDF content types.
3. **Normalize**: HTML → Markdown keeping headings, lists, tables and links, stripping navigation,
   footers and scripts (readability-style main-content selection); PDF text via `pdf-lib` is not
   enough — use the text layer through a PDF text extraction approach available in the baseline or
   document the gap and skip PDFs with a TODO-free `not_supported` record.
4. **Chunk**: along headings, roughly 400–800 tokens (approximate tokens by characters, documented),
   never across top-level sections, with parent heading path; keep tables intact where possible.
5. **Enrich**: metadata `{ url, title, heading_path, carrier, region, life_situations, language,
   content_hash, retrieved_at }` and validity dates where stated.
6. **Embed**: OpenAI embeddings through the AI SDK (`embedMany`), model from `EMBEDDING_MODEL`
   (default `text-embedding-3-large` with `dimensions: 1536` to match the column), batched, retried
   on rate limits.
7. **Index**: upsert `source` by URL; when the content hash is unchanged, skip; when changed,
   replace its chunks in one transaction. CLI `ingest [--origin x] [--limit n] [--dry-run]`.
8. **Synonyms**: `synonyms.yaml` with Austrian synonym groups (Spital/Krankenhaus,
   Chefarzt/kontrollärztlicher Dienst, e-card, Rezeptgebühr and more) with schema validation; used
   by WP-104.

## Acceptance criteria

- [ ] AC1: Fetcher refuses a non-allowlisted origin and a redirect to one; respects a robots.txt
  disallow (tests against a local HTTP server in the test).
- [ ] AC2: Normalizer and chunker produce stable output on saved fixture pages (a real oegk.at
  page saved under `test/ingest/fixtures/`), with headings preserved and chunk sizes in range.
- [ ] AC3: Indexing fixture chunks into real Postgres writes `source` and `kb_chunk` rows; a
  second run with the same content writes nothing; changed content replaces the chunks
  (`test:db`, embeddings from a deterministic local function in this test only, clearly confined to
  the test directory).
- [ ] AC4 (live): ingesting one real allowlisted page end to end with real OpenAI embeddings
  produces chunks whose German full-text search and vector search both find a known sentence.

## Notes for the implementer

- Be polite to public sites: tiny live test, one page.
- Keep provider calls behind one small function so WP-104 and E10 can swap models.

## Suggested commits

- `feat(knowledge): add allowlist, source list and synonyms`
- `feat(knowledge): add allowlisted fetcher with robots and conditional requests`
- `feat(knowledge): add markdown normalizer, chunker and enrichment`
- `feat(knowledge): add embedding and hash-based indexing into pgvector`
