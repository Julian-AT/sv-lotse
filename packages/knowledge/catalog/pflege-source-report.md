# WP-157 source and verification report

Checked on 2026-11-06. All records await human verification; `verified_at` is intentionally absent.

## Scope and decisions

- Seven benefits, each with its own process: Pflegegeld, Vienna care advice, FSW funding for mobile services, Pflegekarenz, Pflegeteilzeit, Pflegekarenzgeld and 24-hour care support. Shared `care` life situation assembles the bundle.
- Nine federal Sozialministeriumservice Landesstellen. The regional offices are intake contacts for 24-hour support; Pflegekarenzgeld is processed nationwide in Steiermark. Employment arrangements remain with the employer; SMS is a counseling and cash-benefit contact.
- Vienna mobile services are one FSW funding benefit covering Heimhilfe and Hauskrankenpflege. Other states require regional service records; no Vienna funding rule is applied outside Vienna.
- There are no registered form templates in this checkout. Application records use publisher/search hints; advice requires no application form. Empty appointment channels await human verification, independently of sourced office contact details.
- Pflegegeld eligibility hours/duration and care level are assessed by the responsible professionals and carrier. The process records the decision and never derives a care level from symptoms or findings. Minor status and documented dementia are used only for the administrative exception to the leave threshold.
- Immediate reminders (`after_days: 0`) are task prompts. Calendar-month deadlines are quoted and explained, never converted to guessed day counts. No reminder submits an application or contacts anyone.
- Unusual or multiple pension sources require carrier clarification; no payer is guessed. SVS/BVAEB central offices are intake contacts; PVA uses residence-based Landesstellen.
- The source pages do not give a general mandatory attachment list for the Pflegegeld application or for free FSW advice. These document arrays remain empty rather than inventing mandatory documents.

## Legal bases

Paragraph citations were cross-checked against the original, read-only SozDok snapshot under `data/svbox/Rechtstexte/`:

- `BPGG=PARA=4=12=2015-01-13=2015-01-01.xml`: § 4 Abs. 1–2, duration and care-hour thresholds.
- `BPGG=PARA=21b=109=2024-07-19=2024-07-20.xml`: § 21b Abs. 2, 24-hour support requirements.
- `BPGG=PARA=21c=109=2023-07-21=2023-11-01.xml`: § 21c, cash benefit, employment, duration and proportional payment.
- `BPGG=PARA=21d=109=2023-07-21=2023-11-01.xml`: § 21d, declaration, applications and deadlines.
- `BPGG=PARA=21e=129=2022-07-28=2023-01-01.xml`: § 21e Abs. 7, overlapping support.
- The official employment-law page names §§ 14c–15 AVRAG. The catalog cites §§ 14c–14d AVRAG for the two leave arrangements. No AVRAG provision exists in the supplied snapshot; no SozDok version date is invented.

## Live URL and quotation ledger

22 official source URLs; 101 quotations. Quotes were compared with freshly fetched HTML/PDF text after whitespace normalization. PDF text was extracted with `pdftotext -layout`; the current FSW application identifies itself as V8 03/2026. HTML links and abbreviation expansions can differ in the web tool rendering, so original fetched text controls the quotations.

### https://www.fsw.at/antrag

Retrieved at: 2026-11-06T00:06:59Z

- **fapply**: Den ausgefüllten und unterschriebenen Antrag können Sie direkt auf MeinFSW einreichen. Sie können den Antrag auch gemeinsam mit den notwendigen Beilagen und Unterlagen per E-Mail oder Post an den FSW schicken.
- **fcurrent**: Es sind immer die aktuellen Formulare von dieser Seite zu verwenden.

### https://www.fsw.at/downloads/foerderwesen_anerkennung/foerderansuchen/subjektfoerderung/fsw-antrag-auf-foerderung-von-leistungen.pdf

Retrieved at: 2026-11-06T00:06:59Z

- **fid**: Amtlicher Lichtbildausweis. Zum Beispiel: Führerschein, Reisepass, Personalausweis
- **fnationality**: Nachweis der Staatsbürgerschaft. Zum Beispiel: Staatsbürgerschaftsnachweis, Reisepass, Personalausweis
- **fstatus**: Wenn Sie keine österreichische Staatsbürgerschaft haben: Nachweis über Ihren Aufenthaltsstatus
- **frepresentative**: Wenn Sie von einer anderen Person vertreten werden: Nachweis der Vertretungsbefugnis.
- **fincome**: Aktuelle Nachweise über Ihr Einkommen. Zum Beispiel:
- **frent**: aufgeschlüsselten Nachweis über Hauptmietzins und Betriebskosten von Ihrer Wohnung oder Ihrem Haus.
- **fexpenses**: Nachweise über pflegebezogene Ausgaben, zum Beispiel Pflegebett, Notrufsystem.
- **frelatives**: Wenn Sie unterhaltsverpflichtete oder unterhaltsberechtigte Angehörige haben:
- **fmarried**: Wenn Sie verheiratet oder verpartnert sind: Heiratsurkunde oder Urkunde über die eingetragene Partnerschaft
- **fdivorced**: Wenn Sie geschieden sind oder Ihre eingetragene Partnerschaft aufgelöst wurde: Scheidungsurteil oder Scheidungsbeschluss
- **fwidowed**: Wenn Ihr:e Partner:in gestorben ist: Sterbeurkunde von dem:der Ehepartner:in oder eingetragenen Partner:in
- **fchild**: Bei Minderjährigen müssen Sie zusätzlich folgende Unterlagen beilegen:

### https://www.fsw.at/p/hauskrankenpflege

Retrieved at: 2026-11-06T00:06:59Z

- **nursing**: Die Mitarbeiter:innen des FSW-Kund:innenservice stellen den individuellen Bedarf fest.
- **fcost**: Der Kostenbeitrag für Kund:innen ist abhängig von ihrem Einkommen, ihren Unterhaltspflichten bzw. -berechtigungen, den Miet- und Wohnkosten, dem Pflegegeld und den in Anspruch genommenen Leistungen.

### https://www.fsw.at/p/heimhilfe-pflege-betreuung

Retrieved at: 2026-11-06T00:06:59Z

- **home**: Das FSW-Kund:innenservice stellt den individuellen Bedarf fest.

### https://www.fsw.at/p/pflege-betreuung

Retrieved at: 2026-11-06T00:06:59Z

- **fcontact**: Rufen Sie einfach beim FSW-Kund:innentelefon unter 01/24 5 24 an oder kommen Sie persönlich bei uns im FSW-Kund:innenservice vorbei.
- **advice**: Beim FSW-Kund:innenservice werden Sie kostenlos beraten. Und Sie bekommen Hilfe dabei, den Antrag auf Förderung zu stellen.
- **fadvice**: Sie möchten wissen, welche Pflege- und Betreuungsangebote es in Wien gibt? Der Fonds Soziales Wien berät Sie und sorgt dafür, dass Sie genau die Unterstützung bekommen, die Sie brauchen.

### https://www.oesterreich.gv.at/de/themen/pflege/5/1/Seite.360529

Retrieved at: 2026-11-06T00:06:59Z

- **insured**: Vorliegen einer Vollversicherung (Krankenversicherung, Unfallversicherung und Pensionsversicherung) aufgrund eines unmittelbar vor Inanspruchnahme der Pflegekarenz oder Pflegeteilzeit liegenden, ununterbrochenen Arbeitsverhältnisses von zumindest drei Monaten
- **proofofright**: Nachweis der Inanspruchnahme der Pflegekarenz und -teilzeit ( SMS ) aufgrund des Rechtsanspruchs
- **ams**: Abmeldung beim AMS vom Bezug des Arbeitslosengeldes und der Notstandshilfe
- **marginal**: Wenn vor der Inanspruchnahme der Pflegekarenz oder Pflegeteilzeit eine geringfügige Beschäftigung vorlag, ist der Bezug eines Pflegekarenzgeldes nicht möglich.
- **deadline**: Erfolgt die Antragstellung auf Pflegekarenzgeld innerhalb von zwei Monaten ab Beginn der Pflegekarenz, Pflegeteilzeit oder Familienhospizkarenz, so gebührt das Pflegekarenzgeld bereits ab Beginn dieser Maßnahme.
- **late**: Wird der Antrag nach dieser Frist, jedoch vor dem Ende der Karenzierung gestellt, gebührt das Pflegekarenzgeld ab dem Tag der Antragstellung . Anträge, die nach dem Ende der Maßnahme gestellt werden, werden als verspätet zurückgewiesen.
- **shortdeadline**: In Fällen, in denen eine Pflegekarenz oder Pflegeteilzeit aufgrund eines Rechtsanspruchs in Anspruch genommen wurde und es zu keiner weiteren Vereinbarung gekommen ist, ist die Beantragung des Pflegekarenzgeldes bis zur Beendigung der Maßnahme, längstens jedoch zwei Monate nach Beginn der Maßnahme, zulässig.
- **kgduration**: Eine nahe Angehörige/ein naher Angehöriger kann bei einer Pflegekarenz oder Pflegeteilzeit – je nach vereinbarter Dauer mit der Arbeitgeberin/dem Arbeitgeber – zwischen einem und drei Monaten Pflegekarenzgeld beziehen.
- **kgamount**: Der Grundbetrag des Pflegekarenzgeldes ist einkommensabhängig und gebührt in derselben Höhe wie das Arbeitslosengeld (55 Prozent des täglichen Nettoeinkommens), zumindest jedoch in Höhe der monatlichen Geringfügigkeitsgrenze .
- **kgpart**: Da im Falle einer Pflegeteilzeit/Familienhospizteilzeit die Arbeitszeit reduziert und das Einkommen verringert wird, gebührt das Pflegekarenzgeld aliquot.

### https://www.pv.at/web/service-und-kontakt/kontakt

Retrieved at: 2026-11-06T00:06:59Z

- **pva-region**: Die Zuständigkeit der Landesstellen richtet sich ausschließlich nach dem Wohnort , bei Wohnsitz im Ausland ist die Landesstelle Wien zuständig.

### https://www.sozialministerium.gv.at/Themen/Arbeit/Arbeitsrecht/Karenz-und-Teilzeit/Pflegekarenz-und-Pflegeteilzeit.html

Retrieved at: 2026-11-06T00:06:59Z

- **carelevel**: nahe Angehörige, denen zum Zeitpunkt des Antritts Pflegegeld ab Stufe 3 nach dem Bundespflegegeldgesetz (BPGG) mit Bescheid zuerkannt wurde.
- **exception**: demenziell erkrankte oder minderjährige nahe Angehörige ab Pflegegeld Stufe 1.
- **agreement**: Voraussetzung für den Antritt einer Pflegekarenz oder einer Pflegeteilzeit ist eine schriftliche Vereinbarung zwischen Arbeitnehmerinnen- bzw. Arbeitnehmer- und Arbeitgeberinnen- bzw. Arbeitgeberseite. Diese Vereinbarung kann getroffen werden, wenn das Arbeitsverhältnis seit ununterbrochen zumindest drei Monaten besteht.
- **tenhours**: Die wöchentliche Normalarbeitszeit darf bei der Pflegeteilzeit nicht unter zehn Stunden liegen.
- **kduration**: Pflegekarenz und Pflegeteilzeit stellen Überbrückungsmaßnahmen dar. Die Dauer ist auf ein bis drei Monate festgelegt. Eine zeitliche Unterbrechung, und damit eine Aufteilung der Pflegekarenz oder Pflegeteilzeit, ist nicht zulässig.
- **right**: Arbeitnehmerinnen und Arbeitnehmer haben ab 1. Jänner 2020 einen Rechtsanspruch auf zwei Wochen Pflegekarenz/Pflegeteilzeit.
- **size**: Der Rechtsanspruch gilt in Betrieben mit mehr als fünf Arbeitsnehmerinnen und Arbeitnehmern.
- **extension**: Kommt währenddessen keine Vereinbarung über eine Pflegekarenz/Pflegeteilzeit zustande, so besteht ein Anspruch auf Pflegekarenz/Pflegeteilzeit für bis zu weiteren zwei Wochen (insgesamt vier Wochen).
- **unpaid**: Bei der Pflegekarenz entfällt das Arbeitsentgelt gänzlich, bei der Pflegeteilzeit nur aliquot.

### https://www.sozialministerium.gv.at/Themen/Pflege/24-Stunden-Betreuung.html

Retrieved at: 2026-11-06T00:06:59Z

- **minlevel**: Bezug von Pflegegeld ab der Stufe 3
- **relation24**: Vorliegen eines Betreuungsverhältnisses zur pflegebedürftigen Person, zu einem Angehörigen oder zu einem gemeinnützigen Anbieter
- **qualification**: Die Betreuungspersonen müssen entweder eine theoretische Ausbildung nachweisen, die im Wesentlichen derjenigen Heimhilfe entspricht, oder seit mindestens sechs Monaten die Betreuung der pflegebedürftigen Person sachgerecht durchgeführt haben. Alternativ dazu muss eine fachspezifische Ermächtigung (Delegation) der Betreuungsperson zu pflegerischen Tätigkeiten vorliegen.
- **income24**: Die Einkommensgrenze beträgt 2.500 Euro netto monatlich, wobei Leistungen wie Pflegegeld, Sonderzahlungen, Familienbeihilfe, Kinderbetreuungsgeld und Wohnbeihilfen unberücksichtigt bleiben.
- **dependants24**: Für unterhaltsberechtigte Angehörige erhöht sich die Einkommensgrenze um 400 Euro bzw. um 600 Euro für unterhaltsberechtigte Angehörige mit Behinderung.

### https://www.sozialministerium.gv.at/Themen/Pflege/Pflegegeld.html

Retrieved at: 2026-11-06T00:06:59Z

- **duration**: ständiger Betreuungs- und Hilfsbedarf wegen einer körperlichen, geistigen oder psychischen Behinderung beziehungsweise einer Sinnesbehinderung, die voraussichtlich mindestens sechs Monate andauern wird,
- **hours**: ständiger Pflegebedarf von monatlich mehr als 65 Stunden,
- **residence**: gewöhnlicher Aufenthalt in Österreich (unter bestimmten Voraussetzungen kann das Pflegegeld auch in einen EWR-Staat oder in der Schweiz geleistet werden)
- **levels**: Pflegegeld wird – je nach Ausmaß des erforderlichen Pflegebedarfes und unabhängig von Alter und Ursache der Pflegebedürftigkeit – in sieben Stufen gewährt.
- **payer**: Bezieherinnen und Bezieher einer Pension oder Rente bringen den Antrag auf Pflegegeld beim zuständigen Versicherungsträger ein. Das ist jene Stelle, die auch die Pension bzw. Rente auszahlt, zum Beispiel
- **nonpension**: Berufstätige Personen, mitversicherte Angehörige (zum Beispiel als Hausfrau oder Kind) und Bezieherinnen und Bezieher einer Mindestsicherung oder eines Rehabilitationsgeldes können das Pflegegeld bei der Pensionsversicherungsanstalt beantragen.
- **assess**: Die Betroffenen werden zu Hause, im Pflegeheim oder, falls unumgänglich, im Krankenhaus von einer Ärztin/einem Arzt oder von einer diplomierten Gesundheits-und Krankenpflegeperson aufgesucht. Dieser Hausbesuch ist vorher anzukündigen.
- **authority**: Die Entscheidung über die gebührende Pflegestufe ist eine Rechtsfrage und trifft der Sozialversicherungsträger oder das Gericht.
- **trusted**: Auf persönlichen Wunsch ist bei der ärztlichen Untersuchung auch die Anwesenheit und Anhörung einer Vertrauensperson (z.B. die Pflegeperson) zu ermöglichen, um Angaben zur konkreten Pflegesituation zu machen.
- **pgform**: Antragsformulare für Zuerkennung oder Erhöhung des Pflegegeldes erhalten Sie beim jeweiligen Pensionsversicherungsträger oder auf oesterreich.gv.at .
- **pension-map**: bei ASVG-Pension die Pensionsversicherungsanstalt (PVA) , bei Bundespension, Beamtenpension eines Landes oder einer Gemeinde sowie Pension bei Eisenbahnen und Bergbau, die Versicherungsanstalt Öffentlich Bediensteter, Eisenbahnen und Bergbau (BVAEB) bei GSVG-Pension (Gewerbetreibende) und BSVG-Pension (Bauern) die Sozialversicherungsanstalt der Selbständigen (SVS)
- **amounts**: Pflegebedarf in Stunden pro Monat Stufe Betrag in Euro (monatlich, 2026) mehr als 65 Stunden 1 206,20 mehr als 95 Stunden 2 380,30 mehr als 120 Stunden 3 592,60 mehr als 160 Stunden 4 888,50 mehr als 180 Stunden, wenn ein außergewöhnlicher Pflegeaufwand erforderlich ist 5 1.206,90 mehr als 180 Stunden, wenn zeitlich unkoordinierbare Betreuungsmaßnahmen erforderlich sind und diese regelmäßig während des Tages und der Nacht zu erbringen sind oder die dauernde Anwesenheit einer Pflegeperson während des Tages und der Nacht erforderlich ist, weil die Wahrscheinlichkeit einer Eigen- oder Fremdgefährdung gegeben ist 6 1.685,40 mehr als 180 Stunden, wenn keine zielgerichteten Bewegungen der vier Extremitäten mit funktioneller Umsetzung möglich sind oder ein gleichzuachtender Zustand vorliegt 7 2.214,80

### https://www.sozialministeriumservice.gv.at/Angehoerige/Pflege_und_Betreuung/24-Stunden-Betreuung/24-Stunden-Betreuung.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **need24**: Bezieht die pflegebedürftige Person ein Pflegegeld der Stufen 3 oder 4, ist die Notwendigkeit einer 24-Stunden-Betreuung durch das Sozialministeriumservice gesondert festzustellen. Die Entscheidung erfolgt auf Basis des zuletzt erstellten Pflegegeldgutachtens.
- **amount24**: Die Förderung kann monatlich bis zu EUR 1.600,- bei unselbständigen Arbeitsverhältnissen oder bis zu EUR 800,- bei Werkverträgen von selbständigen Betreuungskräften betragen.
- **timing24**: Zeitliche Nähe ist dann gegeben, wenn das Ansuchen spätestens in dem Monat einlangt, der auf den Beginn des Betreuungsverhältnisses folgt.
- **late24**: Bei später einlangenden Ansuchen ist eine Förderung frühestens mit Beginn des Monates vor der Ansuchenstellung möglich.
- **pgproof**: Nachweis über Pflegegeld
- **pgreport**: Bei Bezug eines Pflegegeldes der Stufen 3 und 4: Das zuletzt erstellte Pflegegeldgutachten (wenn möglich)
- **incomeproof**: Einkommensnachweise der pflegebedürftigen Person (Pensionsbescheid oder Kontoauszüge, letzter Einkommenssteuerbescheid, letzter Einheitswertbescheid)
- **registration**: Meldezettel der Betreuungskraft/-kräfte
- **business**: Gewerbeschein oder Gewerberegisterauszug der Betreungskraft/kräfte
- **insurance24**: Nachweis der Vollversicherung in der Sozialversicherung
- **a1**: Bei einer Betreuungskraft, die in einem anderen EU-Mitgliedstaat sozialversichert ist, ein entsprechender Nachweis (insbesondere Formular A1/E101)
- **training**: Ausbildungsnachweis oder Pflegeermächtigung (wenn vorhanden, nach Möglichkeit übersetzt), ansonsten erfolgt Hausbesuch durch Qualitätszentrum für Pflege (SVS Bauern)

### https://www.sozialministeriumservice.gv.at/Angehoerige/Pflege_und_Betreuung/Pflegekarenz_und_-teilzeit/Pflegekarenz_und_-teilzeit.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **dominant**: Erklärung der überwiegenden Pflege und Betreuung für die Dauer der Pflegekarenz oder Pflegeteilzeit
- **smsst**: Die Bearbeitung der Anträge erfolgt österreichweit durch das Sozialministeriumservice - Landestelle Steiermark.
- **exclusion**: Personen, die eine Pflegekarenz oder eine Pflegeteilzeit vereinbart haben, können für die vereinbarte Dauer auch keine Förderung einer 24-Stunden-Betreuung beziehen.

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Burgenland/Sozialministeriumservice___Landesstelle_Burgenland.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-burgenland**: Neusiedler Straße 46, 7000 Eisenstadt
- **sms-phone-burgenland**: Tel: 02682/64 046
- **sms-email-burgenland**: post.burgenland@sozialministeriumservice.gv.at

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Kaernten/Sozialministeriumservice___Landesstelle_Kaernten.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-kaernten**: Kumpfgasse 23-25, 9020 Klagenfurt
- **sms-phone-kaernten**: Tel: 0463/5864-0
- **sms-email-kaernten**: post.kaernten@sozialministeriumservice.gv.at

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Landesstellen_des_Sozialministeriumservice.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **smsregional**: Die Landesstellen des Sozialministeriumservice sind die regionale Anlaufstellen in den Bundesländern.
- **smsapplications**: Auch alle Anträge können hier gestellt werden.

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Niederoesterreich/Sozialministeriumservice___Landesstelle_Niederoesterreic.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-niederoesterreich**: Daniel-Gran-Straße 8/3. Stock, 3100 St. Pölten
- **sms-phone-niederoesterreich**: Tel: 0 27 42/ 31 22 24
- **sms-email-niederoesterreich**: post.niederoesterreich@sozialministeriumservice.gv.at

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Oberoesterreich/Sozialministeriumservice___Landesstelle_Oberoesterreich.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-oberoesterreich**: Gruberstraße 63, 4021 Linz
- **sms-phone-oberoesterreich**: Tel: 0732/7604-0
- **sms-email-oberoesterreich**: post.oberoesterreich@sozialministeriumservice.gv.at

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Salzburg/Sozialministeriumservice___Landesstelle_Salzburg.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-salzburg**: Auerspergstraße 67a, 5020 Salzburg
- **sms-phone-salzburg**: Tel: 0662/88 983-0
- **sms-email-salzburg**: post.salzburg@sozialministeriumservice.gv.at

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Steiermark/Sozialministeriumservice___Landesstelle_Steiermark.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-steiermark**: Babenbergerstraße 35, 8020 Graz
- **sms-phone-steiermark**: Tel: 0316/7090
- **sms-email-steiermark**: post.steiermark@sozialministeriumservice.gv.at

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Tirol/Sozialministeriumservice___Landesstelle_Tirol.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-tirol**: Herzog-Friedrich-Straße 3, 6020 Innsbruck
- **sms-phone-tirol**: Tel: 0512/ 56-31-01
- **sms-email-tirol**: post.tirol@sozialministeriumservice.gv.at

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Vorarlberg/Sozialministeriumservice___Landesstelle_Vorarlberg.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-vorarlberg**: Rheinstraße 32/3, 6900 Bregenz
- **sms-phone-vorarlberg**: Tel: 05574/6838
- **sms-email-vorarlberg**: post.vorarlberg@sozialministeriumservice.gv.at

### https://www.sozialministeriumservice.gv.at/Ueber_uns/Sozialministeriumservice/Landesstellen/Wien/Sozialministeriumservice___Landesstelle_Wien.de.html

Retrieved at: 2026-11-06T00:06:59Z

- **sms-wien**: Babenbergerstraße 5, 1010 Wien
- **sms-phone-wien**: Tel: 01/588 31
- **sms-email-wien**: post.wien@sozialministeriumservice.gv.at

## Additional pages opened during research

These pages were inspected for navigation or context and are not used as record provenance. Redirect aliases are listed as requested as well as their canonical destinations.

- https://www.fsw.at/p/pflege-betreuung-daheim — “Praktische Unterstützung im Alltag” (links to Heimhilfe and Hauskrankenpflege).
- https://www.sozialministerium.gv.at/Themen/Pflege/Betreuende-und-Pflegende-Angehoerige.html — “Voraussetzung ist, dass der Betrieb mehr als fünf Angestellte beschäftigt.”
- https://www.sozialministerium.at/Themen/Pflege/Betreuende-und-Pflegende-Angehoerige.html — redirects to the preceding canonical page; same quote.
- https://www.sozialministerium.at/Themen/Pflege/24-Stunden-Betreuung.html — redirects to the canonical ministry source in the ledger; “Bezug von Pflegegeld ab der Stufe 3”.

## Unavailable URLs attempted

The following URLs were opened but the web tool could not retrieve them. No quote could be verified and no claim relies on them. Working official replacement pages are in the ledger.

- https://www.sozialministeriumservice.gv.at/Angehoerige/Pflege_und_Betreuung/Pflegekarenzgeld/Pflegekarenzgeld.de.html
- https://www.fsw.at/p/mobile-hauskrankenpflege
- https://www.fsw.at/p/heimhilfe
- https://www.fsw.at/p/foerderungen
- https://www.pv.at/web/pension/pflegegeld

## Verification

- `docker compose up -d --wait`: exit 1; port 127.0.0.1:9000 already allocated. Existing services were not stopped or altered.
- `bun run --filter @lotse/brain db:migrate`: exit 0; database migrations applied against configured real Postgres.
- `bun run --filter @lotse/knowledge catalog:load`: exit 0; catalog loaded into real Postgres; awaiting review: catalog=8, processes=8, offices=315.
- `bun run --filter @lotse/knowledge e2:scan`: exit 0; E2 generalization scan passed.
- `bun run --filter @lotse/knowledge test`: exit 0; 13 files and 209 tests passed.
- Additional temporary data audit passed: 101/101 live quotes, seven benefit/process pairs, declared condition slots, resolved office links and 177 live-backed source entries across the new records. No new code or dependencies were added.
