# Future audio generator stub — documentation only

There is no executable generator in this set. This outline is for the later
recording/synthesis step and makes no provider calls.

```text
generateAudio(cases, recordingOrSynthesisConfig, outputDirectory):
  validate the versioned E9 text set
  for each case:
    read case.input.utterance with a consenting speaker or configured voice
    preserve the literal numbers, dates, names, dialect and self-corrections
    review the actual speech against case.expected.transcript
    save the audio under the stable case ID
    save a manifest linking that ID to the audio checksum, format, duration,
      recording/synthesis method, speaker/voice metadata and text-set version
  report missing or rejected recordings; do not substitute silence or fake audio
```

Keep human recordings and synthesized samples distinguishable in the manifest.
Do not expose reference transcripts to the recognition provider as recognition
output. If a speaker departs from the prompt, re-record or version the corrected
reference after review; never relabel an inaccurate transcript as correct.
Synthesis alone cannot establish performance on real dialect speech. Future
provider configuration and credentials must follow the repository's validated
environment configuration rules; credentials do not belong in the manifest.

An independent later adapter will transcribe the audio, compare it with the
reference under documented WER/domain-term normalization, and collect per-stage
timings in the Mac app. A text-only loader cannot measure either metric.
