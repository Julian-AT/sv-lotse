# WP-160 source and verification report

Checked on 2026-11-06 (Europe/Vienna). Retrieval timestamps use UTC. Every quote below was checked against the fetched public official HTML. Only whitespace at HTML element boundaries is normalized; German wording and punctuation are retained. The catalog and process records carry the applicable quotes themselves. No human verification date has been supplied.

## Scope and decisions

- Three catalog records and three process records: prescription-fee exemption for ÖGK, SVS and BVAEB, Wiener Mindestsicherung and Styrian Sozialunterstützung.
- Carrier office rules cover all nine federal states. Vienna covers all 23 districts, U25 and the specialist office for homelessness, threatened housing loss or existing Dauerleistungen. Styria covers Graz and all twelve district authorities.
- Residence criteria have machine-checkable conditions over declared process slots. Income and status determinations remain sourced text for carrier/authority review: household income weighting, child supplements, exceptions and SVS agricultural rules cannot safely be replaced by a single threshold comparison. The condition grammar has no arithmetic.
- Current-year fee thresholds are restricted to 2026 in the intake slot. The SVS active-farmer route retains its separate published Einheitswert limits. Higher-expense eligibility is based on existing documentation for carrier review, never an inference from symptoms or findings.
- The official annual-cap pages disagree on the minimum: oesterreich.gv.at states 41 fees, the SVS page states exemption from the 38th prescription, while ÖGK states a minimum of EUR 314.01. The record quotes the official guidance, describes the two-percent cap and the existence of a minimum, and relies on carrier-confirmed status. It deliberately performs no pack-count calculation.
- No relevant form template is registered in this checkout, so forms use publisher/search hints. Application channels are described in process questions with supporting public-source quotes; no authenticated page was accessed.
- Appointment channels require verified_at in the frozen schema. Because this brief reserves verification for a person, these arrays stay empty. Existing office references provide contact and appointment information. No verification dates or unreviewed booking origins were invented.
- The Graz document checklist is the sourced regional starting point; district authorities may request different or additional evidence. Items marked optional are conditional on the applicant’s circumstances, rather than universally necessary.
- The Styrian source explicitly names § 7 Abs. 2 StSUG, preserved as the legal basis. State-law sources name WMG/StSUG rather than SozDok paragraph records; no SozDok identifier or further paragraph number was invented. Prescription-fee pages used here do not name statutory paragraphs.
- Reminders at one or seven days are voluntary product reminders, not claimed statutory deadlines. The actual Styrian change-notification limit of two weeks and Vienna’s request-specific supplementation deadlines remain sourced separately.
- Processes prepare checklists and obtain a user statement of submission; preparation alone is not represented as submission or an entitlement decision. Helper participation does not replace the subject’s required signature.
- No code or test files were changed: scope permits data only. Existing schema/loader/scanner tests and the supplemental source/routing audit verify the records. No new package command or convention was introduced.
- Firecrawl CLI was unavailable. Official pages were opened with the web tool; pages that the web tool could not retrieve were checked successfully with curl. Python’s default local TLS trust store failed, so the source-text audit used curl with certificate verification enabled.

## Checked URLs and verbatim German quotes

### 1. https://www.sozialversicherung.gv.at/cdscontent/?contentid=10007.870471&portal=oegkportal

> Wenn Ihr monatliches Nettoeinkommen folgende Richtsätze nicht übersteigt, können Sie einen Antrag auf Befreiung von der Rezeptgebühr stellen: Alleinstehende: EUR 1.308,39 Ehepaare: EUR 2.064,12

> Wenn Sie einen erhöhten Bedarf an Medikamenten aufgrund einer Krankheit oder eines Gebrechens haben, gelten folgende Richtsätze für Sie: Alleinstehende: EUR 1.504,65 Ehepaare: EUR 2.373,74 Die Richtsätze für Ehepaare gelten auch für Lebensgemeinschaften und eingetragene Partnerschaften.

> Für jedes Kind erhöht sich der Richtsatz um EUR 201,88, sofern das Nettoeinkommen des Kindes den Grenzbetrag von EUR 481,23 nicht erreicht. Für Kinder über 18 werden weitere Voraussetzungen geprüft. Wir berücksichtigen dabei Ihr Einkommen und das Ihrer Partnerin bzw. Ihres Partners zu 100 Prozent. Das Einkommen aller anderen Personen, die im selben Haushalt leben, rechnen wir mit 12,5 Prozent an.

> Folgende Personengruppen sind automatisch von der Rezeptgebühr befreit: Bezieherinnen und Bezieher einer Ausgleichszulage oder eines Ausgleichszulagenbonus bzw. Pensionsbonus Zivildiener Bezieherinnen und Bezieher von Sozialhilfe, die aufgrund des Bezugs von Sozialhilfe krankenversichert sind

> Einkommensbelege von allen im gemeinsamen Haushalt lebenden Personen (z.B. Gehaltszettel, Pensionsbescheid, Firmenpension, Auslandsrente, Unfallrente, Arbeitslosengeld, Sozialhilfe)

> Belege über den Bezug von Unterhalt Gerichtsbeschluss und Vergleichsausfertigung einer Scheidung

> Medikamentenliste von der Ärztin oder dem Arzt (nur bei Zutreffen der Befreiungsgründe)

> Rezeptgebühr-Befreiung beantragen Wie wollen Sie das Service nutzen? Meine ÖGK-Website (ID Austria erforderlich) Fertig ausdrucken und per Post schicken Leeres Formular herunterladen

### 2. https://www.svs.at/cdscontent/?contentid=10007.816812&portal=svsportal

> Auf Antrag ist eine Rezeptgebührenbefreiung bei der SVS für aktiv erwerbstätige Versicherte wegen geringen Einkommens möglich, wenn der Einheitswert des land(forst)wirtschaftlichen Betriebes EUR 6.800,00 (bei alleinstehenden Betriebsführer/innen) bzw. EUR 10.800,00 (bei verheirateten bzw. in eingetragener Partnerschaft lebenden Betriebsführer/innen) nicht übersteigt.

> Besondere soziale Schutzbedürftigkeit ist anzunehmen, wenn das monatliche Nettoeinkommen EUR 1.308,39 nicht übersteigt. Für Ehepaare bzw Lebensgefährten im gemeinsamen Haushalt beläuft sich die Einkommensgrenze auf EUR 2.064,12.

> Befreiung von der Kostenbeteiligung und Rezeptgebühr nach dem GSVG Inhalte relevant für: Gewerbetreibende Neue Selbständige PDF (0.1MB) Online Antrag

> Weiterführende Informationen erhalten Sie in Ihrer SVS-Landesstelle.

### 3. https://www.bvaeb.at/cdscontent/?contentid=10007.840469&portal=bvaebbportal&viewmode=content

> Alleinstehende bis zu einem Nettoeinkommen von EUR 1.308,39 Ehepaare/eingetr. Partner bis zu einem Nettoeinkommen von EUR 2.064,12 für jedes mitversicherte Kind erhöht sich der Richtsatz um EUR 201,88

> Für Personen, die wegen eines Gebrechens oder Leidens einen erhöhten Medikamentenbedarf nachweisen können, wie chronisch Kranke, erhöhen sich diese Richtsätze um 15 %:

### 4. https://www.oesterreich.gv.at/de/themen/hilfe_und_finanzielle_unterstuetzung_erhalten/armut-in-oesterreich/Seite.1693902

> Es besteht eine Deckelung der Rezeptgebühren: Wer im laufenden Kalenderjahr bereits zwei Prozent des Jahresnettoeinkommens für Rezeptgebühren bezahlt hat, ist automatisch für den Rest des Jahres von der Rezeptgebühr befreit. Ein Antrag ist nicht erforderlich.

> Personen, die nicht von der Rezeptgebühr befreit sind, müssen in jedem Fall mindestens 41 Rezeptgebühren zu je 7,55 Euro (Wert für 2026) zahlen, bevor die Zwei-Prozent-Deckelung der Rezeptgebühren zur Anwendung kommt (Mindestobergrenze).

### 5. https://www.soziales.steiermark.at/cms/beitrag/12706097/61183307/

> Grundsätzlich können nur jene Personen Sozialunterstützung nach dem StSUG (Steiermärkisches Sozialunterstützungsgesetz) erhalten, die ihren Hauptwohnsitz und ihren tatsächlichen Aufenthalt in der Steiermark haben sowie

> zu einem dauernden Aufenthalt im Inland berechtigt sind und sich grundsätzlich seit mindestens fünf Jahren im Bundesgebiet aufhalten (unionsrechtliche und völkerrechtliche Bestimmungen sehen aber auch Ausnahmen zur 5-Jahres-Frist vor, z.B. für Asylberechtigte).

> Bevor Sozialunterstützung gewährt werden kann, müssen die Antragstellenden zunächst die eigenen Mittel (Einkommen und Vermögen) zur Bestreitung des Lebensunterhaltes einsetzen. Auch müssen gleichartige Leistungen, die Bund oder Land gewähren, zuerst in Anspruch genommen werden.

> Gibt es Ansprüche gegen Dritte (z.B.: Unterhalt, Schadenersatz, offene Gehaltszahlung etc.), so müssen diese verfolgt werden.

> Die Höhe der Leistung ist vom Einsatz der Arbeitskraft abhängig. Dies gilt für arbeitsfähige Personen und Personen, die nach § 7 Abs 2 StSUG nicht vom Einsatz der Arbeitskraft ausgenommen sind.

> Jede bekannte Änderung, die für die Gewährung der Sozialunterstützung maßgeblich ist, muss der Behörde so schnell wie möglich, längstens binnen zwei Wochen, gemeldet bzw. angezeigt werden.

### 6. https://www.graz.at/cms/beitrag/10269022/7761791/Sozialunterstuetzung.html

> amtlichen Lichtbildausweis (Reisepass, Personalausweis, Führerschein, ID-Card) Geburtsurkunde Staatsbürgerschaftsnachweis Nachweis über rechtmäßigen Aufenthalt (Aufenthaltstitel oder -bescheinigung)

> Mietvertrag Grundbuchsauszug Betriebskostennachweis sonstige wohnungsbezogene Kosten

> Lohnbestätigung Einkommensteuerbescheid Leistungsbezugsbestätigung des Arbeitsmarktservice, Nachweise über Pensions-/Rentenleistungen Bestätigung der Krankenkasse über Krankengeld und Kinderbetreuungsgeld

> Vermögensverzeichnis Sparbücher Bausparverträge Kontoauszüge Aktien / Wertpapiere

> Bestätigung der Vormerkung zur Arbeitssuche Gutachten zur Arbeitsunfähigkeit Nachweise über Verhinderung des Einsatzes der Arbeitskraft

> Vertretungsnachweis (Erwachsenenschutzvertreter / Vollmacht)

> Stellen Sie einen Antrag - online, mittels Formular, einfachen Schreiben/Mail oder persönlich

> Für persönliche Gespräche vereinbaren Sie bitte einen Termin - telefonisch oder online auf unserer Buchungsseite. Anträge und Unterlagen senden Sie uns bitte per E-Mail oder Post.

### 7. https://www.soziales.steiermark.at/cms/ziel/108519437/DE/

> Anträge auf Sozialunterstützung nehmen die Bezirkshauptmannschaften bzw. das Sozialamt der Stadt Graz entgegen.

> Online-Antrag zur Gewährung der Sozialunterstützung

### 8. https://www.wien.gv.at/amtswege/mindestsicherung-antrag

> Die Grundlage bildet das Wiener Mindestsicherungsgesetz.

> Ihren Lebensmittelpunkt sowie Ihren Hauptwohnsitz in Wien haben und sich tatsächlich in Wien aufhalten

> Personen, die über kein oder ein zu geringes Einkommen (unterhalb der Mindeststandards) verfügen, können Wiener Mindestsicherung beantragen. Die Anspruchsvoraussetzungen für die Zuerkennung von Mindestsicherung sind vielfältig und immer im Einzelfall zu beurteilen. Das Sozialzentrum klärt in diesem Zusammenhang die Familien-, Vermögens- und Wohnverhältnisse der Antragsteller*innen ab.

> österreichische*r Staatsbürger*in oder diesen gleichgestellt sind und bestimmte Zusatzvoraussetzungen erfüllen.

> Als Antragsteller*in sind Sie verpflichtet, Ihren Arbeitswillen nachzuweisen (Meldung beim AMS). Davon ausgenommen sind Personen, denen keine Arbeit zugemutet werden kann.

> Sie haben keinen Anspruch auf Mindestsicherung, wenn Sie eine weiterführende Ausbildung absolvieren (zum Beispiel Studium oder Maturalehrgang nach Lehrabschluss oder Fachschulabschluss) und darum keiner Vollbeschäftigung nachgehen können. und bereits eine abgeschlossene Ausbildung (zum Beispiel Lehrabschluss, Fachschulabschluss) oder einen Schulabschluss auf Maturaniveau haben.

> Amtlicher Lichtbildausweis, zum Beispiel Reisepass

> Personaldokumente, zum Beispiel: Erste und letzte Seite des Anerkennungsbescheides des Bundesamtes für Fremdenwesen und Asyl, aktueller Aufenthaltstitel, Heiratsurkunde, rechtskräftige Scheidungsunterlagen (Scheidungsurteil oder Scheidungsbeschluss, Scheidungsvergleich), Geburtsurkunden der Kinder usw.

> Aktuelle Einkommensbelege, zum Beispiel: Lohn-/Gehaltsbestätigungen (Nettoeinkommen), Nachweis über Leistungen des Krankenversicherungsträgers (zum Beispiel Krankengeld, Kinderbetreuungsgeld, Rehabilitationsgeld), Unterhaltszahlungen, Pensionsbescheid/Rentenbescheid, Bescheide über Beihilfen, Nachweis über Art und Höhe sonstiger Einkünfte

> Nachweise über beantragte Leistungen, zum Beispiel: Anträge auf Leistungen des Arbeitsmarktservice, Leistungen des Krankenversicherungsträgers, Unterhalt/Alimente, Pension und sonstige Einkünfte

> Nachweise über Vermögen, zum Beispiel: Kontoauszüge, Sparguthaben, Wertpapiere, Bausparverträge, Rückkaufswert der Lebensversicherung/Pensionsvorsorge, Erbe, Schenkungen, Kfz und Grundbesitz

> Mietbelege, zum Beispiel: Mietvertrag, Nachweis über die Höhe der aktuellen Miete (Mietaufschlüsselung)

> Nachweis über die Kontoinhaber*in, zum Beispiel Kontoauszug

> Behindertenpass gemäß § 40 Bundesbehindertengesetz – BBG

> Bitte reichen Sie nur einen Antrag ein: online oder per unterstützter Online-Antragstellung im Sozialzentrum. Wenn Sie Anträge mehrfach einreichen, dauert die Bearbeitung länger.

> Etwaige Ansprüche beginnen erst ab der Antragsabgabe.

> Wenn Ihr Antrag nicht von allen volljährigen Personen unterschrieben ist und/oder die Lichtbildausweise fehlen, wird Ihnen ein Verbesserungsauftrag zugeschickt.

> Fehlen andere für die Berechnung der Mindestsicherung notwendige Unterlagen, so werden Sie aufgefordert diese binnen einer angemessenen Frist nachzureichen. Langen diese Unterlagen nicht fristgerecht ein, so wird der Antrag abgewiesen.

### 9. https://www.wien.gv.at/zusammenleben/sozialhilfe-mindestsicherung-standorte-oeffnungszeiten

> Für alle anderen Anfragen und Lebenslagen wenden Sie sich an das Sozialzentrum, das für den Bezirk zuständig ist, in dem Sie wohnen: Wohnbezirke 1, 2, 3, 4, 5, 6, 7, 8, 9 und 20: Sozialzentrum Walcherstraße Wohnbezirke 10, 12 und 23: Sozialzentrum Lemböckgasse Wohnbezirke 13, 14, 15, 16, 17, 18 und 19: Sozialzentrum Linke Wienzeile Wohnbezirke 11, 21 und 22: Sozialzentrum Beatrix-Kempf-Gasse

> Das Zielgruppenzentrum Erdbergstraße ist zuständig für obdachlose Personen, Dauerleistungen und bei drohendem Wohnungsverlust.

> U25 - Beratung für Jugendliche von 18 bis 24

### 10. https://www.bvaeb.at/cdscontent/?contentid=10007.860147&portal=bvaebportal

> Antrag auf Befreiung von der Rezeptgebühr / vom Behandlungsbeitrag (PDF, 724 KB) auch als online-Service mit Login in MeineBVAEB

### 11. https://www.oesterreich.gv.at/de/formsearch/form/65

> Rezeptgebühr/Serviceentgelt für die E-Card - Befreiung

### 12. https://www.graz.at/cms/beitrag/10018736/7761766

> Unterlagen gesichert übermitteln per Online Formular

### Redirect checked

- https://www.graz.at/cms/beitrag/10018736/7761766?cms_nearest=10269022 redirected to the canonical Graz Sozialunterstützung URL listed above. Supporting quote:

> Stellen Sie einen Antrag - online, mittels Formular, einfachen Schreiben/Mail oder persönlich

Discovery-only search-result URLs were not used as evidence. All twelve distinct fetched pages and the Graz redirect URL are listed above.

## Supplemental audit

- 55 embedded source instances matched the official page text.
- Every criterion source is also listed in the parent record’s sources array.
- Every condition variable is a declared process slot.
- 27 carrier/state combinations, 368 Vienna combinations (district, age boundary, housing emergency and Dauerleistung), and 13 Styrian districts each matched exactly one office. Wrong-state cases did not match either regional catalog record.
- Regional submission transitions require submission_confirmed == true.
- All six records remain awaiting human review.

## Gate results

- `docker compose up -d --wait`: exit 1. Docker could not bind `127.0.0.1:9000` because that port was already allocated. No other project's services were stopped or reconfigured.
- `bun run --filter @lotse/brain db:migrate`: exit 0, `Database migrations applied.`
- `bun run --filter @lotse/knowledge catalog:load`: exit 0, `Catalog loaded.` All three benefits and three processes loaded into the configured real Postgres; all remain awaiting human review.
- `bun run --filter @lotse/knowledge e2:scan`: exit 0, `E2 generalization scan passed.`
- `bun run --filter @lotse/knowledge test`: exit 0, 13 test files and 209 tests passed.
- Supplemental quote/routing audit: exit 0, 55 source instances and all 408 office-routing cases passed. The audit used the actual fetched official pages and schema-loaded records, with no service doubles.
- Existing MinIO readiness endpoint at `http://127.0.0.1:9000/minio/health/ready`: HTTP success, curl exit 0. Existing real services were available even though this worktree's compose startup collided with their ports.

The orchestrator should rerun the exact Docker startup gate in its intended compose environment. No dependency, code, schema, generated file or package convention changed.
