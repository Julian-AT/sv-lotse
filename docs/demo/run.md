# Scenario 3: from discharge letter to a prepared next step

Use the fictional Anna Berger PDF from the challenge. The demonstration quotes its documented
rehabilitation recommendation and prepares administration. It never interprets the findings,
chooses a therapy, submits an application, sends an email or books an appointment.

## Prepare

From the repository root, with Node 22+, Bun, the original SV-Box files and `.env.local` available:

```sh
bun install --frozen-lockfile
# Start these only if the shared Postgres/MinIO services are not already running.
docker compose up -d --wait
bun run demo:seed --catalog-only
bun run --filter @lotse/web dev --webpack
```

The seed applies committed migrations, runs the same public catalog loader as `catalog:load`,
registers the original rehabilitation form in MinIO/Postgres, detects its actual AcroForm fields,
and ingests the two official rehabilitation pages with real OpenAI embeddings. It fails if an
original, database, object store, source page or provider is unavailable. It does not manufacture
retrieval passages, recommendation facts, completed steps, appointment availability or approvals.
It rejects build-time fixture mode. `SVBOX_DIR` can override the original input folder; relative
paths resolve from the repository root, even when the command runs from another directory.

Use a migrated, disposable database if the shared development database has drifted. Set
`DATABASE_URL` in the command environment; the seed never edits environment files or resets data.
Required environment: `DATABASE_URL`, `S3_*`, `SESSION_SECRET`, `APPROVAL_HMAC_SECRET`, and
`OPENAI_API_KEY`. Do not paste their values into terminal recordings or reports.

Open `/workspace` in the browser used for the presentation. To create the named demo subject in
that browser's session, run this once in its developer console and copy only the returned UUID:

```js
(await (await fetch('/api/session', { method: 'POST' })).json()).userId
```

Then, from a terminal using the same database:

```sh
bun run demo:seed --user-id <UUID>
```

Refresh `/workspace`. This creates a new empty case attached to the authenticated anonymous user;
it preserves prior cases and facts. Without `--user-id`, the seed creates a separate anonymous demo
owner and prints opaque IDs only. That owner has no browser session; for the clickable demonstration
use the browser UUID above. `--catalog-only` prepares shared assets without creating a subject.
The seeded subject's name is fictional demo metadata, not a confirmed personal fact.

In Settings select **L2** (prepare with confirmation). The default L1 deliberately cannot fill or
commit forms. Use German and, optionally, simple language. The click-and-say script also works as
text input. Browser E2E covers typed input; native microphone and spoken captions need a separate
voice rehearsal.

## Click and say

Wait for each answer or extraction to finish. Exact prose varies because the models are live.
Use the visible source quotes and tool results as the checkpoints.

| Action | Say / type | Visible checkpoint |
| --- | --- | --- |
| Open the empty case. Upload `Befunde/Entlassungsbefund.pdf` from SV-Box. | “Ich habe einen Entlassungsbrief. Bitte helfen Sie mir bei den nächsten Verwaltungsschritten.” | Upload succeeds. Extracted quotations appear as unconfirmed facts. Do not ask the pilot to explain the diagnosis or findings. |
| Find the card containing the explicit rehabilitation recommendation. Expand **Im Dokument anzeigen**. | Read the displayed recommendation exactly as written, including its source page. | The original PDF page is displayed with the extracted source rectangle highlighted. The quotation remains verbatim. |
| Press **Bestätigen** on that recommendation. | “Ich möchte den Antrag auf medizinische Rehabilitation gemeinsam vorbereiten.” | The pilot asks whether this is the intended administrative goal. |
| Confirm the goal. | “Ja, genau das ist mein Ziel.” | The confirmed goal is saved. The catalog and process can now be used. |
| Ask for the catalog and choose its actual medical rehabilitation result. | “Bitte suchen Sie medizinische Rehabilitation im Katalog ohne lifeSituation-Filter. Ich wähle [angezeigter Titel]. Verwenden Sie dessen zurückgegebene Katalogkennung.” | A real catalog record supplies the identifier for process, office and checklist tools. |
| Supply the fictional demonstration's administrative answers explicitly. | “Bitte starten Sie den passenden Prozess. Ich bin in Pension, meine Pension kommt von der PVA, ich wohne in Wien. Das Krankenhaus hat kein Anschlussheilverfahren beantragt. Bitte speichern Sie diese Antworten und ermitteln Sie die zuständige Stelle für den Reha-Antrag.” | Responsible contact in Vienna with official source and channels. Health-insurance carrier alone must not determine the pension carrier. These are demo user statements, not deductions from a diagnosis. |
| Ask for the original common form. | “Bitte suchen Sie das registrierte Formular ‘Antrag auf Rehabilitations-, Kur- bzw. Erholungsaufenthalt’, lesen Sie sein Schema und legen Sie einen Entwurf an. Suchen Sie ohne Trägerfilter. Medizinische Felder und Unterschriften bleiben leer. Zunächst möchte ich nur meinen Namen eintragen.” | The actual two-page SV-Box form opens inside the conversation, with fields and provenance controls. Its automatically detected schema is awaiting human review. |
| Choose **Korrigieren: Patient(in)** on the PDF. Enter `Anna Berger`, then **Korrektur speichern**. | “Das ist meine Namensangabe für diese fiktive Demo.” | A sourced keyboard statement is stored; the field remains a draft. Other fields remain empty. |
| Ask for the live fill. | “Bitte lesen Sie meinen Formularentwurf und meine bestätigte Namensangabe. Tragen Sie jetzt nur das Feld Patient(in) sichtbar als Entwurf im Browser-Formular ein. Fordern Sie noch keine Gruppenbestätigung an.” | The cursor types the name, with source caption. The field remains a draft. |
| Request review of that exact group. | “Bitte fordern Sie jetzt die Freigabe genau dieses Namensfelds und seines unveränderten Entwurfswerts an. Alle anderen Felder bleiben offen.” | A server-issued approval card shows the exact field, value and provenance. |
| Review the exact field/value and press **Zustimmen**. | “Diese Feldgruppe stimmt.” | Exactly the reviewed field becomes confirmed with a persisted approval ID. A correction requires fresh approval. No submission occurs. |
| Request the checklist and facilities. | “Bitte erstellen Sie die Unterlagenliste für die gewählte Reha-Leistung. Suchen Sie danach Rehabilitationseinrichtungen in Wien im Umkreis von 100 Kilometern. Die Auswahl dient nur der Kontaktaufnahme, nicht der medizinischen Eignung.” | Sourced required documents, missing/obtainable status and where to get them; sourced facility choices. The medical section stays with the doctor. |
| Choose a facility from the actual results. | “Bitte suchen Sie Kontaktmöglichkeiten zur Einrichtung [angezeigter Name]. In den nächsten vier Wochen vormittags, Ausgangsort Wien, maximal 100 km, Deutsch, keine zusätzlichen Zugänglichkeitswünsche. Bereiten Sie einen Anruf-Spickzettel, einen E-Mail-Entwurf und eine Kalendervormerkung vor. Ich werde selbst Kontakt aufnehmen.” | Real contact channels, explicit unknown preferences, drafts and a tentative calendar hold. No live time slots or confirmed appointment are claimed. |
| Update the journey. | “Die Anlaufstelle und Kontaktentwürfe sind geklärt. Schließen Sie nur die Zuständigkeitsklärung mit meiner Aussage als Beleg ab und bereiten Sie den nächsten offenen Schritt vor. Der medizinische Teil fehlt und der Antrag wurde nicht eingereicht.” | **Mein Weg** shows the completed responsibility step and the remaining open steps. The case is not marked wholly completed. |

Open `/documents?caseId=<case UUID>` to review the checklist. Select the rehabilitation benefit
if the selector has no current choice. Open `/offers?caseId=<case UUID>` and press **Karte laden**
to show the sourced facilities; this explicitly loads OpenStreetMap. From a facility, choose
**Termin vorbereiten** for editable drafts and a downloadable `.ics` hold. These views use the
same persisted case, not a second conversation.

If the assistant completes only the first part of a multi-part request, ask for the outstanding
part separately. If it asks whether a form or contact draft belongs to the existing goal, confirm
that substep; approve field values only with the displayed **Zustimmen** control. The automated
rehearsal also separates these handoffs and uses identifiers from actual tool results.
The sourced office result has its own contact card. Expand **Quellen zur Anlaufstelle** to inspect
the original quotations and dates independently of the assistant's prose.

The broader PRD demonstration also includes Pflegegeld, mobile care, travel costs, prescription-fee
exemption acquisition and EKO coverage. Those are separate follow-on requests and are not claimed
as coverage of this rehabilitation-flow E2E. The hospital-only Anschlussheilverfahren form must
remain with the hospital; never use it for the applicant live-fill scene.

## Automated live rehearsal

```sh
RUN_LIVE=1 bun run demo:e2e
```

This creates a unique database, seeds real shared assets, runs Playwright against a dedicated web
Webpack development server with polling on port 3031, and drops only its own database afterward. It uses real Postgres, MinIO,
official source fetches, OpenAI embeddings, extraction, classification, orchestration and guards.
It fails rather than skips when live opt-in, provider credentials or dependencies are missing.
The database role needs `CREATEDB`. It never resets the configured database.
`demo_source_failed` with `code: PROVIDER_LIMIT` and `status: 429` means the provider rejected
indexing because of a rate or quota limit. Restore availability and rerun; the seed never reports
ready with missing embeddings. The current rehearsal status and remaining gates are recorded in
[verification.md](./verification.md).

Install Chromium through the existing Playwright setup. If macOS sandboxing prevents launching it,
point the suite at a matching remote Playwright server that can reach the local app:

```sh
RUN_LIVE=1 \
PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3002/ \
PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' \
bun run demo:e2e
```

For an already seeded disposable database, run
`RUN_LIVE=1 bun run --filter @lotse/web e2e:demo`. The ordinary browser smoke configuration excludes
this paid live suite. Traces are off; screenshots of the fictional document, approved form and
journey go into `apps/web/test-results/`. Treat screenshots as document content if changing the
fixture. The test removes its uploaded objects and anonymous user, even on failure. The shared
content-addressed original form is retained for reuse.

The suite asserts persisted successful tool results, a pending server approval before committing,
exactly one approved field, sourced office/facility results, tentative appointment output, and a
completed plus still-open journey. Assistant prose alone cannot make it pass.

Useful non-provider checks:

```sh
bun run typecheck
bun run --filter @lotse/web test -- test/conversation-form.test.ts test/document-evidence.test.ts
```
