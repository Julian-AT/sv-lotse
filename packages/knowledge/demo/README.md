# Discharge-letter demonstration inputs

`discharge.json` points to unchanged challenge assets under `SVBOX_DIR` (default `data/svbox/`).
The patient is fictional. The display name identifies the demo subject; it is not a confirmed fact.
The form title and mapped labels are transcribed from the original `Antrag Kur und Reha.pdf`.
Only applicant name, applicant address and phone labels receive administrative fact mappings.
All detected provider ownership and signature restrictions are preserved. The schema stays `auto`;
no human review is implied. Other values are entered and confirmed through the actual UI.

The listed official pages are already cited by the repository rehabilitation catalog, as retrieved
2026-11-06. The seed fetches their full current content with the normal allowlist/robots checks and
indexes it using real embeddings; it does not index this manifest as a knowledge source.

`onboarding-letter.json` is a separate, self-contained fictional teaching document, authored
2026-11-06. It contains administrative text only and no medical findings or recommendations.
The onboarding UI displays the German document verbatim in both interface languages. Its
highlight and name provenance are exact substrings of this document. It never reads SV-Box,
stores patient facts, calls a model or sends an application.
