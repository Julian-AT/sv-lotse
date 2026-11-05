# WP-159 source and validation report

Checked on 6 November 2026 (Vienna; retrieval timestamps are UTC). All records await human review; no verified_at is supplied. Only the six family YAML records and this report are changed.

## Curation decisions and limits

- The three records share life_situations: [familie-mit-kind]. Office references resolve to the existing WP-155/WP-156 directory. The pass record routes administrative proof questions to the insurer; examinations and pass issuance remain with the treating doctor. Carrier precedence is Wochengeld carrier, current/last insurer, then ÖGK if never insured.
- No registered family form templates exist in this checkout. Beih 100, optional Beih 3, the national Kinderbetreuungsgeld application and pass proof sheets use official publisher/search hints. No template UUID or PDF asset is invented.
- Appointment channels remain empty: the frozen channel schema requires verified_at, which only a person can provide. Existing office records supply contact channels.
- The October 2026 ministry update takes precedence over the older general portal's reference to the internal examination. Existing paper passes remain valid, with a supplement for new services. No examination findings are interpreted.
- Proof requirements concern full Kinderbetreuungsgeld, not basic eligibility. Their conditions remain textual because electronic transmission, late proof and unavoidable omissions require insurer review. Missing attachments do not prevent application preparation; the 182-day lookback is explicitly preserved.
- Family eligibility conditions describe the domestic ordinary case. Adult-child, residence-status, cross-border and income-system exceptions require the responsible authority's assessment; no automatic denial or medical assessment is encoded. Beih 3 is offered only on request, without inferring disability from symptoms or records.
- Reminder after_days: 0 creates a planning/check prompt, not a legal deadline or a calendar-month calculation. Copy names the actual age-based proof deadlines and asks for birth-date-based scheduling. No arbitrary seven-day or thirty-day legal deadline is invented.
- Process YAML is validated against the WP-101 structural contract. WP-102 runtime execution is not available in this checkout. Outputs describe preparation or the user's own handover; no process submits an application, books an appointment or enters credentials.
- No permanent test code is added because this WP owns data paths only. A temporary behavior check was run first and failed on the absent first record, then passed for all three pairs; it checks provenance, office/process links, declared condition slots, outputs, reminders and both BMF search hints. Existing package tests remain unchanged.

## Catalog sources: opened and verbatim quotes confirmed

Each URL below was opened in the web tool and fetched directly again. All listed German quotes matched the official HTML after Unicode/whitespace normalization. Full per-record retrieval timestamps are in YAML.

### https://www.sozialministerium.gv.at/Themen/Gesundheit/Eltern-und-Kind/Eltern-Kind-Pass.html

> Nach Feststellen einer Schwangerschaft erhält jede Schwangere mit Wohnsitz in Österreich von Ihrem betreuenden Arzt/Ihrer betreuenden Ärztin einen Eltern-Kind-Pass.

> Das neue Untersuchungsprogramm gilt ab 01.10.2026 in ganz Österreich und somit auch für einen bereits ausgestellten Papierpass.

> Nur Untersuchungen und Beratungen, die im jeweiligen Zeitraum noch nicht gemacht wurden, erfolgen nach dem neuen Untersuchungsprogramm und werden entsprechend dokumentiert.

> Die Durchführung der Schwangerenuntersuchungen 1-5 sowie die Kindesuntersuchungen 1-5 (bis zum 14. Lebensmonat des Kindes) ist Voraussetzung für den Erhalt des Kinderbetreuungsgeldes in voller Höhe.

> Für die Dokumentation der neuen und zusätzlichen Untersuchungen erhalten Sie, bis zur Umstellung auf den elektronischen Eltern-Kind-Pass (verpflichtende Einführung ab Oktober 2027), von Ihrem betreuenden medizinischen Fachpersonal ein Zusatzheft

### https://www.oesterreich.gv.at/de/themen/familie_und_partnerschaft/finanzielle-unterstuetzungen/3/2/Seite.080625

> Bei der Antragstellung müssen die fünf Schwangerschaftsuntersuchungen und die erste Untersuchung des Kindes (in Kopie) nachgewiesen werden.

> Die restlichen Untersuchungen müssen bis zum 15. Lebensmonat des Kindes (ebenfalls in Kopie) nachgewiesen werden.

> Wenn beide Elternteile Kinderbetreuungsgeld beziehen, erfolgt der Abzug von 1.300 Euro bei jedem der Elternteile.

> Fertigen Sie eine Kopie der Nach­weisblätter an, aber belassen Sie die Originalblätter im Eltern-Kind-Pass.

### https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20001474

> In jenen Fällen, in denen die Nachweise erfolgreich elektronisch durch den eEKP gemäß § 6 Abs. 2 EKPG erfolgt sind, entfällt die Nachweispflicht der antragstellenden Elternteile, sofern seitens des Krankenversicherungsträgers keine gegenteilige Information ergeht.

> die jeweiligen Nachweise bis spätestens zur Vollendung des 18. Lebensmonates des Kindes nachgebracht werden.

> die Vornahme oder der Nachweis der Untersuchungen nur aus Gründen, die nicht von den Eltern zu vertreten sind, unterbleibt oder

### https://www.bundeskanzleramt.gv.at/agenda/familie/kinderbetreuungsgeld/antragstellung-formulare-kinderbetreuungsgeld.html

> Für die Antragstellung und Auszahlung dieser Leistungen ist jener Krankenversicherungsträger zuständig, bei dem Wochengeld bezogen wurde beziehungsweise bei dem man versichert (anspruchsberechtigt) ist beziehungsweise zuletzt versichert (anspruchsberechtigt) war.

> Hat bisher keine Versicherung bestanden, ist die Österreichische Gesundheitskasse zuständig.

> Das Kinderbetreuungsgeld (KBG), der Partnerschaftsbonus und die Beihilfe zum pauschalen Kinderbetreuungsgeld gebühren nur auf Antrag. Eine Antragstellung ist frühestens ab dem Tag der Geburt möglich.

> Da das Kinderbetreuungsgeld nur bis zu 182 Tage rückwirkend geltend gemacht werden kann, wird empfohlen, unmittelbar nach der Geburt den Antrag zu stellen, damit keine Bezugszeiten verloren gehen.

> Fehlende Unterlagen können nachgereicht werden.

> Der Antrag ist im Original beim Krankenversicherungsträger einzubringen, hier ist ausnahmslos das bundeseinheitliche Antragsformular zu verwenden. Eine Einbringung per E-Mail ist nicht möglich.

### https://www.oesterreich.gv.at/de/themen/familie_und_partnerschaft/familienbeihilfe/Seite.450233

> Einen Anspruch auf Familienbeihilfe haben Eltern, deren Lebensmittelpunkt in Österreich liegt und deren Kind (leibliches Kind, Adoptivkind, Pflegekind, Stiefkind oder Enkelkind) mit ihnen zusammen in einem Haushalt lebt oder – wenn das Kind mit keinem Elternteil im Haushalt lebt – für das sie überwiegend Unterhalt leisten.

> Ab der Volljährigkeit ist die Gewährung von Familienbeihilfe jedoch im Allgemeinen an das Vorliegen einer Berufsausbildung gebunden.

> Auch in diesem Fall muss kein Familienbeihilfenantrag gestellt werden. Es genügt, das Informationsschreiben mit den Antworten und eventuellen Nachweisen zurückzuschicken.

> Die Familienbeihilfe kann jederzeit beantragt werden. Rückwirkend wird sie jedoch nur für fünf Jahre ab dem Monat der Antragstellung gewährt.

> Finanzamt Österreich

> Grundsätzlich kann die zuständige Stelle zur Überprüfung Ihrer Angaben im Antragsformular die darin angegebenen Dokumente von Ihnen verlangen.

> Nachweis einer laufenden Berufsausbildung oder Studienerfolgsnachweis

> Nachweis über den rechtmäßigen Aufenthalt nach §§ 8 oder 9 Niederlassungs- und Aufenthaltsgesetz (NAG)

### https://www.bundeskanzleramt.gv.at/agenda/familie/familienbeihilfe/basisinformation-zur-familienbeihilfe/antragstellung/antrag-auf-familienbeihilfe-finanzonline.html

> Sie finden hier insbesondere die Vordrucke Beih 100 zur Beantragung der Familienbeihilfe und Beih 3 zur Beantragung des Erhöhungszuschlages für erheblich behinderte Kinder, sowie Beih 20 (Antrag auf Direktauszahlung für volljährige Kinder).

### https://www.sozialversicherung.gv.at/cdscontent/?contentid=10007.879630&portal=oegkportal

> Anspruch und Bezug der Familienbeihilfe für das Kind,

> Lebensmittelpunkt von antragstellendem Elternteil und Kind in Österreich,

> ein auf Dauer angelegter (mindestens 91-tägiger) gemeinsamer Haushalt mit dem Kind und idente Hauptwohnsitzmeldungen an dieser Adresse,

> Einhaltung der Zuverdienstgrenze pro Kalenderjahr.

> Für Nicht-Österreicherinnen und Nicht-Österreicher zusätzlich ein rechtmäßiger Aufenthalt in Österreich (NAG-Karte) bzw. die Erfüllung bestimmter asylrechtlicher Voraussetzungen.

> Bei getrennt lebenden Eltern zusätzlich Obsorgeberechtigung (mit überwiegender Betreuung des Kindes) und Bezug der Familienbeihilfe durch den antragstellenden Elternteil.

> In bestimmten Fällen kann es aber möglich sein, auch bei einem Wohnort oder einer Beschäftigung im EU-Ausland einen Anspruch auf österreichische Familienleistungen zu erwerben.

> Geburtsurkunde des Kindes

> Obsorgeberechtigung für das Kind und Bezug der Familienbeihilfe durch den antragstellenden Elternteil

> Nachweis über den Bezug der ausländischen Familienbeihilfe

> Wochengeldbestätigung bzw. Bestätigung über den Erhalt wochengeldähnlicher Leistungen

### https://www.oesterreich.gv.at/de/themen/familie_und_partnerschaft/finanzielle-unterstuetzungen/3/2/Seite.080613

> Für das einkommensabhängige Kinderbetreuungsgeld gelten neben den allgemeinen auch spezielle Anspruchsvoraussetzungen.

## Additional opened pages (cross-checks, not catalog evidence)

| URL                                                                                                                                                                          | Confirmed German quote                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| https://www.oesterreich.gv.at/de/formsearch/form/146 (via /de/linkresolution/form/146)                                                                                       | Familienbeihilfe - Antrag - Beih100                                                                                                                              |
| https://www.oesterreich.gv.at/de/formsearch/form/147 (via /de/linkresolution/form/147)                                                                                       | Familienbeihilfe – Erhöhungsbetrag wegen erheblicher Behinderung – Antrag – Beih3                                                                                |
| https://service.bmf.gv.at/service/anwend/formulare/show_mast.asp?STyp=HaFo&Typ=SM                                                                                            | Formulare Steuern & Zoll                                                                                                                                         |
| https://www.oesterreich.gv.at/de/themen/familie_und_partnerschaft/familienbeihilfe/Seite.1220330                                                                             | Für den Nachweis der Behinderung erfolgt nach Antragstellung eine Einladung zu einer Untersuchung bei einer sachverständigen Ärztin/einem sachverständigen Arzt. |
| https://www.bundeskanzleramt.gv.at/agenda/familie/kinderbetreuungsgeld/eltern-kind-pass-untersuchungen.html (via https://www.oesterreich.gv.at/de/linkresolution/link/15844) | Bei Mehrlingskindern sind Eltern-Kind-Pass-Untersuchungen für jedes Kind extra nachzuweisen.                                                                     |
| https://www.bundeskanzleramt.gv.at/agenda/familie/kinderbetreuungsgeld/rechtsgrundlage-kinderbetreuungsgeld.html                                                             | Rechtsgrundlage für das Kinderbetreuungsgeld                                                                                                                     |

## Attempted URLs with no retrievable page

The web tool returned Internal Error for these URLs; no quote was inferred and none is used as record evidence. Working canonical pages above replace them.

- https://www.bmf.gv.at/themen/familie/familienbeihilfe.html
- https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20001474&Paragraf=7&FassungVom=2026-11-06
- https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20001474&Paragraf=24c&FassungVom=2026-11-06
- https://www.oesterreich.gv.at/de/themen/familie_und_partnerschaft/finanzielle-unterstuetzungen/3/2/1/Seite.080601
- https://www.oesterreich.gv.at/de/themen/familie_und_partnerschaft/finanzielle-unterstuetzungen/3/2/1/Seite.080620
- https://www.ris.bka.gv.at/eli/bgbl/i/2001/103/P7/NOR40254081

## SozDok cross-checks (read-only SV-Box)

Legal citations were checked against the following local source paragraphs, using metadata in-force dates rather than filenames' publication dates. Online RIS confirms the October 2026 proof exceptions and electronic-proof provision. The older local residence-status snapshot is not encoded as an exhaustive current immigration rule.

- data/svbox/Rechtstexte/FLAG=PARA=2=220=2021-12-30=2022-06-01.xml
- data/svbox/Rechtstexte/FLAG=PARA=3=64=2025-10-31=2025-11-01.xml
- data/svbox/Rechtstexte/FLAG=PARA=8=25=2025-06-30=2026-01-01.xml
- data/svbox/Rechtstexte/FLAG=PARA=10=50=2015-04-22=2015-05-01.xml
- data/svbox/Rechtstexte/FLAG=PARA=10a=104=2019-10-29=2020-07-01.xml
- data/svbox/Rechtstexte/KBGG=PARA=2=64=2025-10-31=2025-11-01.xml
- data/svbox/Rechtstexte/KBGG=PARA=3=25=2025-06-30=2025-07-01.xml
- data/svbox/Rechtstexte/KBGG=PARA=4=53=2016-07-08=2017-03-01.xml
- data/svbox/Rechtstexte/KBGG=PARA=7=115_82=2025-12-30=2026-10-01.xml
- data/svbox/Rechtstexte/KBGG=PARA=24=11=2025-03-18=2025-01-01.xml
- data/svbox/Rechtstexte/KBGG=PARA=24a=25=2025-06-30=2025-07-01.xml
- data/svbox/Rechtstexte/KBGG=PARA=24c=115_115_82=2025-12-30=2026-10-01.xml

## Verification

- Initial temporary behavior check: exit 1, first catalog record absent (expected red). Final check: three complete catalog/process pairs passed.
- Direct official-HTML quote check: all stored quotes found; no failed source fetches.
- Default docker compose up -d --wait: exit 1 because local port 9000 was already allocated to the shared lotse stack. COMPOSE_PROJECT_NAME=lotse docker compose up -d --wait: exit 0, Postgres and MinIO healthy, bucket initialization exited successfully.
- Database configuration was checked without printing its value: local host and WP-159-isolated database confirmed. Brain migrations and catalog loading use that database.
- Final bun run --filter @lotse/brain db:migrate: exit 0, Database migrations applied.
- Final bun run --filter @lotse/knowledge catalog:load: exit 0, Catalog loaded; awaiting review catalog=3, processes=3, offices=306.
- Final bun run --filter @lotse/knowledge e2:scan: exit 0, E2 generalization scan passed.
- Final bun run --filter @lotse/knowledge test: exit 0, 13 test files and 209 tests passed.
- Final source check: 39 unique URL/quote pairs matched across eight official pages, all HTTP 200.
