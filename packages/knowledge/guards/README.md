# Guard data

`safety-net.yaml` defines versioned German/English explicit-statement patterns and the fixed
Austrian notice required by PRD §4 SR-1. The current labels and numbers were checked against the
linked official sources on 2026-11-06. `boundary-rules.yaml` encodes forbidden assistant speech acts
from the PRD. No clinical severity, diagnosis or health-risk inference is encoded here.

Both files are strict-schema validated by the brain at startup. Negation/history/source-context
exclusions apply to individual clauses, never to the entire message. Page, document and screen
content cannot trigger SR-1. The output boundary does not apply exclusions for user negation: its
input is the assistant's proposed speech, with only verified attributed quotes exempted.
`contextTerms` is a separate, data-driven list for post-SR-1 model context: non-current clinical
terms in declarative clauses may be neutralized to prevent unsolicited crisis advice. Questions and
explicit current statements are retained, and this never changes SR-1 input or its fixed notice.
Boundary rule version 4 also covers bilingual findings interpretation/offers, rehabilitation
decisions and unauthorized submission claims. Its separate `medicalRequests` rules recognize
requests to derive clinical justifications in German and English, without treating negated requests
as medical instructions. These are speech-act rules, not clinical judgments.

Author review and automated positive/negative regression checks are complete. The independent
second-person review required by the package rules and independent human confirmation of E5 labels
remain **pending**; the metadata deliberately does not claim that review has happened.

Run `bun run --filter @lotse/brain test -- test/guards` for deterministic checks, including SR-1
against the existing 500-case E5 set. This test is not the live E5 release gate. Live generation,
guarding and independent model judging run with `bun run --filter @lotse/evals eval:e5 run --suite
E5 --out /tmp/e5.json --concurrency 12 --retries 0`.

Ship both YAML files with the brain server. They are read relative to this source module's package
location, independent of the process working directory; missing or malformed data fails startup.
