# ÖGK source verification report

Checked on 2026-11-06. All records await human verification. No code, schema, form registry or office directory changes.

## Coverage

23 catalog records and 23 matching processes cover voluntary insurance (general, students, minor employment), contract doctors, Wahlarzt reimbursement, physiotherapy, ergotherapy, logopaedia, psychotherapy, clinical-psychological treatment and diagnostics, Heilmassage, planned foreign treatment, holiday treatment, hospital care, Krankengeld, Wiedereingliederungsgeld, transport, dental treatment, orthodontics, dentures, hardship assistance and prescribed medicines.

Excluded: rehabilitation (including Rehabilitationsgeld and Kur/Erholung), Heilbehelfe/Hilfsmittel, care, prevention (including child oral hygiene), family/co-insurance, prescription-fee exemption. Informational services (ELGA, magazine, ombudsman) and the facilities directory are not benefit records.

## PDF identity and page references

Local read-only input: `data/svbox/Leistungskataloge/Serviceratgeber-2026_Broschuere_A5_OEAM_99-19_klein_korr.pdf`.

The official download is byte-identical to the SV-Box PDF: SHA-256 `25fb952ab5090a3323fc36dbce862508fba22e596bbfa3f372b1df596314d41b`. The document has 59 PDF pages, with two printed pages on most spreads. Each YAML header records the local path, one-based PDF page and printed page numbers. Source URL fragments use the one-based PDF page. Quotes normalize line wraps and discretionary line-break hyphens.

The brochure states: “Sämtliche Angaben und Werte beziehen sich auf die geltenden Bestimmungen nach dem Stand vom 01.01.2026.” Therefore the seed retains `as_of: 2026-01-01`; retrieval timestamps record the actual check date.

## Decisions and limits

- The frozen source schema accepts HTTP(S) URLs only. Official byte-identical PDF URLs are used; local file provenance is in YAML comments and this report. No schema change.
- No registered form templates exist in this checkout. Published form names are acquisition search hints, not fabricated template references.
- Booking channels require a human verification date in the frozen schema. They remain empty, rather than inventing a review date or treating a contact number or reimbursement portal as an appointment service.
- Medical suitability, diagnosis, ability to work, transport need and treatment choice remain with professionals and the carrier. Processes ask about existing administrative documents only.
- Office rules resolve existing regional ÖGK directory ids from the subject's responsible insurance office; minor-employment self-insurance uses the employment state. Specialized services may forward the request. These are receiving/contact offices, not a determination of legal jurisdiction.
- The PDF does not enumerate every insurance, employment, student-duration or medical exception. Conditions support administrative navigation and do not assert complete entitlement. Carrier clarification is a separate terminal outcome.
- No fixed statutory deadlines are invented: zero-day reminders are immediate task cues. Completion confirms navigation/contact, never benefit approval. Approval paths wait for the carrier decision; they do not infer its result.
- Generic form search hints are used where the PDF does not give an exact registered template. Private invoice branches require the user to confirm a paid detailed invoice.
- Special Krankengeld, foreign-country exceptions, private hospital tariffs and orthodontic subprograms require carrier clarification; the seed does not calculate these outcomes.
- No production logic changed, so no new logic tests were added. Existing schema/reference/scanner tests are the applicable regression suite.

## Every checked URL and its quotation

Landing page opened: https://www.oegk.at/cdscontent/?contentid=10007.890973

> Unsere jährlich erscheinende Broschüre fasst die wichtigsten Informationen und Leistungen der Österreichischen Gesundheitskasse für Sie zusammen.

The search also returned the same official publication at https://www.sozialversicherung.gv.at/cdscontent/?contentid=10007.890973 with the same quotation. Search results from other sources were not used as verified evidence.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=32

> Die ÖGK übernimmt Transportkosten im Inland, wenn eine ärztliche Transportanweisung über die Gehunfähigkeit des Versicherten oder Angehörigen vorliegt.

### https://www.oegk.at/cdscontent/?contentid=10007.870423&portal=oegkportal

> Die Österreichische Gesundheitskasse (ÖGK) unterstützt Sie dabei.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=11

> Für Studierende gibt es zusätzliche Erleichterungen. Einerseits entfällt die Wartezeit, andererseits genügt der gewöhnliche Aufenthalt im Inland. Außerdem gilt: Der monatliche Beitrag beträgt 78,84 Euro. Die begünstigte Studentenversicherung ist an Einkommensgrenzen und Studiendauer gebunden.

> Die Voraussetzungen sind, dass Sie nur geringfügig beschäftigt sind und noch keine Pflichtversicherung in der Kranken- und/oder Pensionsversicherung haben. Das Entgelt, das Sie erhalten, darf die jeweils gültige Geringfügigkeitsgrenze nicht übersteigen. Die Geringfügigkeitsgrenze liegt im Jahr 2026 bei 551,10 Euro.

> Geringfügig Beschäftigte mit Wohnsitz im Inland können sich in der Kranken- und Pensionsversicherung zu einem monatlichen Beitrag von derzeit 83,49 Euro selbst versichern. Das ist die „Selbstversicherung in der Kranken- und Pensionsversicherung nach § 19a ASVG”.

> Personen, die nicht in einer gesetzlichen Krankenversicherung pflichtversichert sind, können sich auf Antrag selbst versichern – solange sich ihr Wohnsitz im Inland befindet. Das ist die „Freiwillige Krankenversicherung nach § 16 ASVG”.

> Bei Vorliegen der erforderlichen Vorversicherungszeiten haben die Versicherten für sich und ihre anspruchsberechtigten Angehörigen sofort Anspruch auf Leistungen aus der Krankenversicherung, sonst nach einer Wartezeit von sechs Monaten.

> Der Monatsbeitrag beträgt derzeit 565,25 Euro. Sie können einen Antrag auf Herabsetzung der Beitragsgrundlage stellen.

> Sie können einen Antrag auf Herabsetzung der Beitragsgrundlage stellen. Legen Sie dem Antrag sämtliche Einkommensnachweise bei.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=12

> Studierende müssen bei Antragstellung und in der Folge jährlich spätestens bis 31.12. eines jeden Kalenderjahres eine Fortsetzungsbestätigung bzw. ein Studienblatt des aktuellen Semesters vorlegen.

### https://www.oegk.at/cdscontent/?contentid=10007.868713&portal=oegkportal

> Die Selbstversicherung kostet 2026 monatlich EUR 78,84.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=20

> Der schriftliche Nachweis, dass spätestens vor der zweiten psychotherapeutischen bzw. klinisch-psychologischen Behandlung eine ärztliche Untersuchung durchgeführt wurde. Diese Bestätigung kann formlos oder durch das dafür vorgesehene Formular erfolgen.

> Bei Behandlungen, die mehr als zehn Therapieeinheiten erfordern, ist ein Antrag auf Bewilligung der Psychotherapie bzw. klinisch-psychologischen Behandlung erforderlich.

> Es ist nicht möglich, gleichzeitig eine Therapie auf Rechnung in einer Vertragseinrichtung bzw. in einem Gesundheitszentrum zu machen und einen Kostenzuschuss zu erhalten.

> Es ist auch nicht möglich, eine klinisch-psychologische Behandlung und eine Psychotherapie gleichzeitig in Anspruch zu nehmen.

> Die ÖGK leistet einen Kostenzuschuss gegen Vorlage der saldierten, detaillierten Honorarrechnung.

> Wir bieten unseren Versicherten Ergotherapie, Logopädie und Physiotherapie nach vorhergehender Verordnung an.

### https://www.oegk.at/cdscontent/?contentid=10007.870222&portal=oegkportal

> Ab der 11. Sitzung ist eine Bewilligung notwendig.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=39

> Werden Leistungen von einer Wahlzahnärztin bzw. einem Wahlzahnarzt im In- oder Ausland erbracht, die zu den Vertragsleistungen zählen, müssen Sie die Rechnung zunächst selbst bezahlen und danach einreichen. Sie erhalten von der ÖGK eine Kostenerstattung in der Höhe von 80 Prozent der entsprechenden Vertragstarife.

> Generelle Voraussetzung für eine Kostenbeteiligung der ÖGK ist, dass der Therapievorschlag eingereicht und vom Zahnmedizinischen Dienst der ÖGK bewilligt wird.

### https://www.oegk.at/cdscontent/?contentid=10007.870418&portal=oegkportal

> Sie können sich bei Vertragszahnärztinnen und Vertragszahnärzten, Wahlzahnärztinnen und Wahlzahnärzten sowie in den Zahngesundheitszentren der Österreichischen Gesundheitskasse (ÖGK) behandeln lassen.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=41

> Für die Anfertigung eines Zahnersatzes stellt Ihnen Ihre behandelnde Vertragszahnärztin bzw. Ihr behandelnder Vertragszahnarzt (Vertragseinrichtung) das Formular „Antrag auf Kostenübernahme für Zahnersatz” aus. Vor Beginn der Behandlung müssen Sie eine Genehmigung bei der ÖGK einholen.

> In medizinisch begründeten Sonderfällen wird ein Zuschuss geleistet, wenn vor der Behandlung die Bewilligung durch den Zahnmedizinischen Dienst der ÖGK eingeholt wurde.

### https://www.oegk.at/cdscontent/?contentid=10007.870472&portal=oegkportal

> Alle Zahnprothesen müssen vor der Anfertigung von der Österreichischen Gesundheitskasse (ÖGK) bewilligt werden.

### https://www.oegk.at/cdscontent/?contentid=10007.870431&portal=oegkportal

> die bezahlte Honorarnote (Original oder Duplikat)

> Für eine Physiotherapie benötigen Sie eine Verordnung (Zuweisung).

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=19

> des gehobenen medizinisch-technischen Dienstes sowie eine Leistung einer Heilmasseurin bzw. eines Heilmasseurs.

> Eine aufgrund ärztlicher Verschreibung oder psychotherapeutischer Zuweisung erforderliche diagnostische Leistung einer klinischen Psychologin bzw. eines klinischen Psychologen.

> Für eine Kostenübernahme einer geplanten Behandlung im Ausland muss vorab eine Bewilligung nach medizinischer Prüfung vorliegen.

> Übermitteln Sie uns das von einem österreichischen Schwerpunkt- bzw. Zentralkrankenhaus ausgefüllte Formular. Sie finden das Formular auf unserer Homepage.

### https://www.oegk.at/cdscontent/?contentid=10007.906197&portal=oegkportal

> Für eine Heilmassage benötigen Sie eine Verordnung (Zuweisung).

> die bezahlte Honorarnote (Original oder Duplikat)

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=22

> Diese verschreibt Ihnen Ihre Ärztin bzw. Ihr Arzt und speichert das e-Rezept im e-card-System. Das Rezept können Sie in jeder öffentlichen Apotheke oder Hausapotheke auf Kosten der ÖGK einlösen.

> Darüber hinaus gibt es bewilligungspflichtige Arzneien, für die Ihre Ärztin bzw. Ihr Arzt eine Genehmigung des Medizinischen Dienstes der ÖGK einholt.

### https://www.oegk.at/cdscontent/?contentid=10007.870460&portal=oegkportal

> Viele Medikamente müssen ärztlich verschrieben werden.

### https://www.oegk.at/cdscontent/?contentid=10007.870510&portal=oegkportal

> Bezahlte Honorarnote (Original oder Duplikat)

> Diese können im Vertrags- oder Wahlbereich tätig sein.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=29

> Dabei gilt: Halber Lohn-/Gehaltsanspruch bedeutet halbes Krankengeld.

> wenn und solange die Arbeitsunfähigkeit der ÖGK nicht gemeldet wird. Das wird in der Regel von der Ärztin bzw. vom Arzt für Sie erledigt.

> Um Ihnen das Krankengeld auszahlen zu können, benötigen wir von Ihnen folgende Unterlagen: y Krankmeldung y Eine „Arbeits- und Entgeltbestätigung”, die Angaben über die Einkommenshöhe und die Dauer einer eventuellen Entgeltfortzahlung enthält. Diese wird von der Dienstgeberin bzw. dem Dienstgeber ausgestellt.

> Vergessen Sie bitte auch nicht, uns Ihre Bankverbindung bekanntzugeben.

### https://www.oegk.at/cdscontent/?contentid=10007.867467&portal=oegkportal

> Krankengeld gebührt frühestens ab dem vierten Tag eines Krankenstandes.

### https://www.oegk.at/cdscontent/?contentid=10007.882758&portal=oegkportal

> Sie brauchen eine Bewilligung durch den Zahnmedizinischen Dienst.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=30

> Mindestens sechswöchige durchgehende Arbeitsunfähigkeit.

> Das aufrechte Beschäftigungsverhältnis besteht schon vor Antritt der Wiedereingliederungsteilzeit seit mindestens drei Monaten durchlaufend – keine Änderung des Dienstvertrages.

> Bei der Beantragung des Wiedereingliederungsgeldes ist zu beachten: Die Wiedereingliederungsvereinbarung, der Wiedereingliederungsplan und allfällige medizinische Unterlagen sind rechtzeitig vor Antritt der Wiedereingliederungsteilzeit an die ÖGK zu übermitteln bzw. persönlich in einer Kundenservicestelle abzugeben. Die Wiedereingliederungsteilzeit kann frühestens am Tag nach der Zustellung der Bewilligung des Wiedereingliederungsgeldes angetreten werden.

> Ärztliche Bestätigung über die wiedererlangte Arbeitsfähigkeit.

### https://www.oegk.at/cdscontent/?contentid=10007.867448&portal=oegkportal

> Dazu kann eine Teilzeitbeschäftigung mit der Arbeitgeberin oder dem Arbeitgeber vereinbart werden, während dieser die Österreichische Gesundheitskasse (ÖGK) zusätzlich Wiedereingliederungsgeld bezahlt.

### https://www.oegk.at/cdscontent/?contentid=10007.897679&portal=oegkportal

> Das bedeutet: Im Rahmen des Vertrages erbrachte Leistungen werden direkt mit der ÖGK verrechnet.

### https://www.oegk.at/cdscontent/?contentid=10007.870660&portal=oegkportal

> Bitte nehmen Sie mindestens zwei Wochen vor dem geplanten Antritt einer Behandlung oder Untersuchung im Ausland mit uns Kontakt auf.

### https://www.oegk.at/cdscontent/?contentid=10007.870415&portal=oegkportal

> die bezahlte Honorarnote (Original oder Duplikat)

> Logopädische Behandlungen bei einem Vertragspartner sind für Sie kostenlos.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=18

> Die Behandlung bei den oben genannten Leistungserbringern wird für Versicherte zuzahlungsfrei von der ÖGK übernommen. Sie müssen Ihre e-card oder einen Überweisungs- oder Zuweisungsschein vorlegen.

> Versicherte müssen das Honorar zunächst selbst bezahlen.

> Die Honorarnote muss Vor- und Familiennamen der bzw. des Versicherten, Versicherungsnummer, Wohnadresse, Zahlungsbestätigung, das Ausstellungsdatum und genaue Angaben über die ärztlichen Leistungen samt Datum enthalten.

### https://www.oegk.at/cdscontent/?contentid=10007.870522&portal=oegkportal

> Nehmen Sie immer Ihre e-card mit!

### https://www.oegk.at/cdscontent/?contentid=10007.870178&portal=oegkportal

> die bezahlte Honorarnote (Original oder Duplikat)

> Ergotherapeutische Behandlungen bei einer Vertragspartnerin oder einem Vertragspartner sind für Sie kostenlos.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=24

> Wenn und solange es die Krankheit erfordert, übernimmt die ÖGK die Kosten in der allgemeinen Gebührenklasse einer landesgesundheitsfondsfinanzierten Krankenanstalt (z.B. Landeskrankenhäuser, Ordensspitäler) oder in einer privaten Vertragskrankenanstalt (Privatkrankenanstalten-Finanzierungsfonds) zur Gänze.

> Sowohl der Kostenbeitrag für Versicherte als auch der Kostenbeitrag für Angehörige ist für längstens 28 Tage im Kalenderjahr zu zahlen.

### https://www.oegk.at/cdscontent/?contentid=10007.870543&portal=oegkportal

> Die stationäre Behandlung wird in der allgemeinen Gebührenklasse gewährt, solange es die Krankheit erfordert.

### https://www.oegk.at/cdscontent/?contentid=10007.870435&portal=oegkportal

> Den Antrag auf Selbstversicherung bei geringfügiger Beschäftigung (§ 19a ASVG) stellen Sie bei der Österreichischen Gesundheitskasse

### https://www.oegk.at/cdscontent/?contentid=10007.867315&portal=oegkportal

> Für die Anmeldung der Selbstversicherung in der Krankenversicherung benötigen wir folgende Dokumente: vollständig ausgefülltes und unterschriebenes Antragsformular Lichtbildausweis Meldebestätigung

> Ihr Wohnsitz ist im Inland.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=43

> Bei finanziellen Belastungen im Zusammenhang mit einer Krankheit oder medizinischen Behandlung, die zu einer Kassenleistung führt, können Versicherte einen Zuschuss beantragen. Dabei werden die Familien-, Einkommens- und Vermögensverhältnisse der betroffenen Person berücksichtigt.

> Stellen Sie für einen Zuschuss aus dem Unterstützungsfonds einen schriftlichen Antrag und legen Sie diesen den entsprechenden Unterlagen bei. Wesentlich sind unter anderem die Einkommensnachweise von allen im gemeinsamen Haushalt lebenden Personen (z.B. Lohn- und Gehaltszettel, Pensionsnachweis) sowie Rechnungen und Kostenvoranschläge.

### https://www.oegk.at/cdscontent/?contentid=10007.870473&portal=oegkportal

> Die Österreichische Gesundheitskasse (ÖGK) hilft in besonderen Notlagen im Zusammenhang mit Gesundheitskosten und bietet deshalb freiwillige Zuschüsse aus dem Unterstützungsfonds an.

### https://www.oegk.at/cdscontent/load?contentid=10008.748630&version=1786021238#page=21

> Mit der EKVK bekommen Sie direkt bei Vertragspartnerinnen und Vertragspartnern im Ausland medizinisch notwendige Sachleistungen. Legen Sie dafür die EKVK den Leistungserbringern (Ärztin oder Arzt, Krankenanstalt usw.) vor.

> Sie müssen Selbstbehalte nach den Rechtsvorschriften des Behandlungsstaats selbst bezahlen.

> Auf der Rückseite der e-card befindet sich die Europäische Krankenversicherungskarte (EKVK).

### https://www.oegk.at/cdscontent/?contentid=10007.870663&portal=oegkportal

> Sie sind bei der Österreichischen Gesundheitskasse (ÖGK) versichert und planen eine Reise im Inland oder ins Ausland?

### https://www.oegk.at/cdscontent/?contentid=10007.870516&portal=oegkportal

> Die ÖGK erstattet die Kosten eines Wahlarztes oder einer Wahlärztin grundsätzlich in der Höhe von 80 Prozent jenes Betrages, den die ÖGK bei Inanspruchnahme eines entsprechenden Vertragspartners bzw. einer Vertragspartnerin aufwenden hätte müssen, jedoch nicht mehr als die tatsächlichen Kosten.

> In den meisten Fällen erstattet Ihnen die ÖGK einen Teil der Kosten zurück.
