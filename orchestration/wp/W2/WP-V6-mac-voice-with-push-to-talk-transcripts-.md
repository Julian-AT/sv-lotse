---
id: WP-V6
title: Mac voice with push-to-talk transcripts and spoken answers
wave: W2
lane: voice
risk: normal
codex_effort: xhigh
depends_on: [WP-012]
fr: [FR-D5, FR-G3, FR-O1, FR-A2]
owns:
  - apps/mac/Packages/LotseKit/Sources/LotseVoice/**
  - apps/mac/Packages/LotseKit/Tests/LotseVoiceTests/**
  - apps/web/src/app/api/voice/**
  - packages/brain/src/voice/**
may_touch:
  - bun.lock
  - packages/brain/package.json
  - apps/web/package.json
allow_deps: what the slice needs at the versions the repository uses; document additions
live_services: [openai]
gates:
  - cd apps/mac && xcodegen generate
  - swift test --package-path apps/mac/Packages/LotseKit
  - xcodebuild -project apps/mac/SVKILotse.xcodeproj -scheme SVKILotse -destination 'platform=macOS' -derivedDataPath .build/dd CODE_SIGNING_ALLOWED=NO build test
  - bun run typecheck
  - RUN_LIVE=1 bun run test:live
pr_title: "feat(voice): speak answers and send push-to-talk transcripts"
---

# WP-V6: Mac voice with push-to-talk transcripts and spoken answers

## Goal and deliverables

Push-to-talk on the Mac produces partial and final transcripts (Apple Speech on-device, de-AT,
as built; ElevenLabs Scribe realtime when `ELEVENLABS_API_KEY` is set, through a single-use token from
`/api/voice/token`), sent over the bridge as `Transcript` with the capsule on final. Speech segments
from the workspace are spoken (ElevenLabs streaming TTS with the configured voice when the key is set,
`AVSpeechSynthesizer` otherwise), firing each segment's actions on sentence start; barge-in stops
speech via `SpeechControl`. Supersedes WP-109.

## Deadline mode (owner, 2026-11-06)

This is a vertical slice for the scenario 3 demo, about 6 hours before the deadline. Make it work end
to end against real services, cleanly but without gold-plating: no new abstractions beyond what the
slice needs, reuse what exists on main, document deviations in the report and keep going. Code quality
standard and safety rules in AGENTS.md still apply (no secrets, approvals server-side, medical
boundary, no hard-coded domain data).

## Acceptance criteria

- [ ] AC1: Unit tests: final transcript sent once per hold; segment actions fire on sentence start;
  barge-in stops playback.
- [ ] AC2: With no ElevenLabs key the fallbacks work (test).

## Suggested commits

- `feat(voice): speak answers and send push-to-talk transcripts`
