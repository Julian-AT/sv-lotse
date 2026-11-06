# Safety boundary

`detectSafetyNet({ text, source, language })` accepts explicit user statements only and returns the
fixed `SafetyNotice` or `null`. Document/page/screen text never enters that detector. The turn
adapter emits the notice once without generation, persists it, and derives administrative scope from
the server-owned history on subsequent turns.

`guardResponse({ text, userText, language, passages, claims, untrustedContent, signal })` checks
citations, deterministic speech-act rules and a structured model-router guard response. Rejected
medical output becomes the fixed doctor/1450 handoff; unsupported citations become an unknown
statement with an office handoff. A medical refusal also becomes the canonical handoff, ensuring
that it names an actual target rather than offering to interpret findings under another name.
Provider errors fail closed; aborts propagate. `guards/14` uses a 0.35 rejection threshold and also
checks that administrative output addresses the actual request. High-precision bilingual request
rules keep invented diagnoses and derived clinical justifications medical even when an application
is the stated purpose. A separate request-only classifier establishes medical versus administrative
intent without seeing the potentially unsafe candidate. Medical requests receive the fixed handoff;
administrative requests still undergo all output checks and can never release a rejected medical
candidate. The model view of retrieved/document/page/screen text also withholds the suffix starting
at an instruction-like marker using bilingual markers from knowledge data. Original sources remain
unchanged; the visible excerpt is always a contiguous original prefix, so omitted fragments can
never become a fabricated verbatim quote. Empty excerpts are withheld. Ordinary instructions to
applicants, such as bringing copies, remain data. This is defense in depth; the policy, output guard
and server-side approvals still apply to all content. The output classifier receives source
provenance as data, never expected E5 labels. It distinguishes the user's intent from an unsafe
generated answer.

`createResponseGuard` permits one bounded administrative repair after an unknown/unsupported or
incomplete candidate. The repair model has no tools, receives only the actual task and available
source data, and its candidate runs through all citation, rule and classifier checks again. Failure
retains the safe fallback. A successful repair returns `disposition: rewrite`: speech drops the
original citations/action IDs, and rejected action captions never release the original action.
Medical requests retain the canonical doctor/1450 handoff.

After the original SR-1 check, `boundaryTaskText` neutralizes non-current crisis terms in
declarative model context only. It retains administrative questions, subject/history and clinical
questions; explicit current emergencies remain unchanged. The original message is persisted
unchanged and is always the input to SR-1. Both the exclusions and clinical context terms live in
knowledge data.

Citation identity, exact source URL and verbatim excerpt are checked deterministically. A separate
support check verifies that the cited excerpts support the entire claim, rather than merely sharing
words. Only verified, delimited and attributed source quotations are exempted from the speech-act
rules. Numeric/UUID references, `[passage:id]` markers and source URLs cannot bypass verification.
The turn stream collects passages from schema-validated `kb.search` results for that turn only.

`createGuardedTextBuffer` holds a complete SDK step before display, checks text spanning multiple
provider deltas, withholds reasoning, and flushes before `finish-step` so database checkpoints stay
ordered. `createGuardedDataWriter` similarly gates tool captions and speech, removes synchronized
actions from rejected speech, and suppresses rejected pointing actions. Request classification and
output classification add bounded model calls per response step; a rejected administrative candidate
may add one repair and recheck. The PRD's sentence-level latency optimization is not implemented
here.

Canonical patterns and notices are data in `packages/knowledge/guards`. The explicit asset URLs in
`config.ts` allow Next.js to trace and package both YAML files in its standalone server. Knowledge
guard assets are read directly; no dependency from knowledge back to brain is introduced.

The threshold is an empirical E5 operating point, not a clinically calibrated score. Independent
pattern review, human E5 label confirmation and model-judge calibration are pending. E5 is run by
`packages/evals/src/e5`: it executes real text generation, guards and a separate response-judge
call. Canonical notices and handoff copy are deterministic; generated answers are judged from actual
task, source context and output without expectation labels. This evaluation does not test tools or
UI.
