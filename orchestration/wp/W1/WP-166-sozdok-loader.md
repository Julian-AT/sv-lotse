---
id: WP-166
title: SozDok XML loader with in-force selection, paragraph chunks and citations
wave: W1
lane: knowledge
risk: normal
codex_effort: high
depends_on: [WP-004]
fr: [FR-G4, E2, E6]
owns:
  - packages/knowledge/src/loaders/sozdok/**
  - packages/knowledge/test/loaders/sozdok/**
may_touch:
  - packages/knowledge/package.json
  - bun.lock
allow_deps: "an XML parser (`fast-xml-parser`, latest stable); `@lotse/brain` as `workspace:*` (only `./db`, `./db/schema`)"
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test
  - bun run --filter @lotse/knowledge test:db
pr_title: "feat(knowledge): add sozdok loader with in-force selection and paragraph chunks"
---

# WP-166: SozDok XML loader with in-force selection, paragraph chunks and citations

## Goal

The 14,244 SozDok XML paragraph versions in `data/svbox/Rechtstexte/` become legal-basis records:
parsed, grouped per law and paragraph, with the version in force on a query date selected, chunked
per paragraph with citation metadata, and loaded into `source` and `kb_chunk` without embeddings
yet. Catalog criteria cite these paragraphs and the Why panel shows
`§ <Paragraph> <Gesetz> (SozDok, in Kraft seit <date>)`.

## Context

- PRD §10 SV-Box dataset table, row "Rechtstexte (SozDok)"; "Ingestion pipeline" step 3 (legal
  texts chunked per paragraph with version date, never across paragraphs); §8 citations; E6.
- `docs/svbox-inventory.md` section "Rechtstexte (SozDok)" describes `Sozdok.xsd` and the file
  naming `<Gesetz>=PARA=<n>=<puborg nr>=<pubdat>=<in force date>.xml`. Root element `sozdok` with
  `dokid`; `rvo/metadaten` attributes (`abkrvo`, `titrvo`, `dokart`, `gldart`, `gldnr`, `pubdat`,
  `ikra` in-force date, `beschdat`, `urheber`, `sichtbarkeit`), `puborgane`, and `nutzdaten` with
  `abschnitt`, `ueberschrift`, `absatz`, `gldsym`.
- `data/svbox/` is read-only. Database (WP-004): `source`, `kb_chunk` (embedding is NOT NULL:
  see Notes).

## Scope

In scope: parser, normalized record type, version selection, paragraph chunker, citation string,
load into Postgres, CLI, tests on real SV-Box files.

Out of scope: embeddings (WP-103's embedder indexes these later), retrieval (WP-104), public
sozdok.at updates.

## Deliverables

1. **Parser** (`src/loaders/sozdok/parse.ts`): every XML file → `{ dokid, law_abbr, law_title,
   doc_type, paragraph (gldnr and gldsym), heading, text (paragraphs joined with absatz numbering),
   published_at, in_force_from, decided_at, publisher, publication refs, visibility }`. Robust to
   missing optional attributes; fails with the file name on structural errors.
2. **Versions** (`versions.ts`): group by law and paragraph; `inForceOn(date)` returns the version
   with the latest `in_force_from` ≤ date; `in_force_to` derived from the next version.
3. **Chunks and citations** (`chunk.ts`): one chunk per paragraph version (split only at `absatz`
   boundaries if a paragraph exceeds ~1,500 tokens, never across paragraphs); citation
   `§ 3 AbrGr andere Vertragspartner (SozDok, in Kraft seit 15.03.2004)`; metadata
   `{ kind: "legal", law_abbr, paragraph, in_force_from, in_force_to, dokid, file }`.
4. **Load** (`load.ts`, CLI `sozdok:load [--on YYYY-MM-DD]`): upsert one `source` per paragraph
   version (url `sozdok://<dokid>`) with text and validity; chunk rows are written only when an
   embedding is supplied (see Notes), so this WP stores sources and exposes chunks for WP-103's
   indexer through a function `sozdokChunks(options)`.
5. **Docs**: a section in `packages/knowledge/README.md` is owned by WP-101; put the loader docs in
   `src/loaders/sozdok/README.md`.

## Acceptance criteria

- [ ] AC1: All 14,244 files parse without error in under 60 seconds (test over the real folder).
- [ ] AC2: For a paragraph with several versions in the data, `inForceOn` picks the right one for
  dates before, between and after versions (test names the concrete file names).
- [ ] AC3: No chunk crosses a paragraph boundary; citations match the PRD format for 5 sampled
  files.
- [ ] AC4: `sozdok:load` writes `source` rows idempotently into real Postgres (`test:db`, on a
  subset folder copied to a temp dir).

## Notes for the implementer

- `kb_chunk.embedding` is NOT NULL, so do not write chunks without embeddings; expose them for the
  indexer instead. Do not change the database schema.
- Text is German; keep `§`, umlauts and non-breaking spaces correct (UTF-8 files).

## Suggested commits

- `feat(knowledge): parse sozdok xml paragraph versions`
- `feat(knowledge): select in-force versions and chunk paragraphs with citations`
- `feat(knowledge): load sozdok sources into postgres`
