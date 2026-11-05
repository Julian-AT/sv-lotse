# E3 retrieval gold questions

200 gold cases derived from 25 opened official source pages, retrieved on 2026-11-05.
The questions are synthetic evaluation utterances; the quoted source passages are real.
No catalog records were used to author the questions.

| Area (PRD §10)                                         | Cases |
| ------------------------------------------------------ | ----: |
| A: Prevention programmes                               |    40 |
| B: Health promotion                                    |    30 |
| C: Treatment benefits and reimbursement administration |    40 |
| D: Care and support for carers                         |    40 |
| E: Family and financial assistance                     |    30 |
| F: Appointments, referrals and approvals               |    20 |

`questions.json` uses the harness `CaseSchema`: `input` contains `area` and `question`,
`source.uri` identifies the page and `source.passage` contains its answering excerpt.
Tags record area, carrier, region, life situation and language. `carrier:all` denotes
cross-carrier information; `region:AT` denotes nationwide information. Questions
include colloquial Austrian German, simple German and English. Similar questions
exercise different formulations; case counts do not imply independent source topics.

`expected.relevantPassages` identifies the relevant page and the SHA-256 of the
UTF-8 source excerpt, so two passages on the same page remain distinct targets.
An E3 retrieval adapter should map retrieved chunks to these source excerpts when
computing recall@10 and nDCG@10. This data package does not run the retrieval engine
or assert a measured retrieval score. `suite.json` records the PRD's informational
recall@10 threshold of 0.9 and minimum set size of 200.

`sources.json` records each source URL, retrieval date, SHA-256 of its fetched HTML
bytes, and the unique excerpts used. Quotes preserve rendered wording and
punctuation, with HTML entities decoded and whitespace collapsed within each line.
A multiline list preserves line breaks. Source-page boilerplate is excluded from
selected excerpts. All excerpts were checked as contiguous substrings of the
rendered text extracted from the fetched HTML. HTML hashes record the initial
retrieval; dynamic page content can change a hash without changing a quote.

The loader tests validate every case and suite with the existing harness schemas,
check size, stratification, unique IDs and questions, tags, official URLs, excerpt
manifest membership and passage hashes. They also run the existing harness leakage
check over all YAML/JSON files under `packages/knowledge/catalog`, recursively.
There are no catalog records in this checkout at authoring time. The check must be
rerun after catalog work packages land; it discovers their files automatically.

Source quotes are provenance excluded by the harness leakage check. Question and
expected-target text remain subject to that check. All questions and targets concern
administrative navigation. No case supplies a diagnosis, interprets findings, assesses
personal medical risk or recommends medication or treatment.

To refresh, open every cited URL, verify each excerpt against the page's rendered
text, update the manifest date and fetched-HTML hash, and update affected cases and
passage hashes together. Review the meaning of each question after a source change.
The normal loader gate is offline and does not claim to check future live-page changes.
