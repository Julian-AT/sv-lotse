# WP-155 source-check report

Checked on 2026-11-05. 195 unique official URLs opened successfully.

Quotes preserve the German source wording. HTML layout whitespace is represented by line breaks. Each YAML record contains the supporting excerpts and retrieval timestamp; human verification remains pending. Sources were read directly over HTTPS after Firecrawl was found unavailable. No form was submitted.

## Coverage

| Carrier | Records | Coverage                                                                                    |
| ------- | ------: | ------------------------------------------------------------------------------------------- |
| ÖGK     |     145 | Nine regional offices and all 136 offices linked by the national customer-service directory |
| PVA     |       9 | All nine Landesstellen                                                                      |
| SVS     |      11 | Head office, nine state customer centres and the published Baden service office             |
| BVAEB   |      11 | Head office, seven Landesstellen, two state branches and the second Linz location           |
| AUVA    |      10 | Head office, four Landesstellen and five state branches                                     |

## Curation decisions

- `region` identifies the state of the office location. Published jurisdiction across several states remains in `jurisdiction`; BVAEB and AUVA do not have nine separate Landesstellen.
- PVA Vienna uses the currently published Ghegastraße customer address. The quote preserves its relocation during renovation and the administrative address.
- SVS telephone service hours are not personal visiting hours. The customer-centre records preserve the appointment-only restriction; their `url` opens the public enquiry form. Baden has separately published visiting hours.
- Opening-hour text preserves split hours, infrequent monthly visits, temporary closures and appointment conditions. Unknown hours and coordinates are omitted.
- Headquarters and customer services remain separate records where they have different functions at a shared address. No unverified benefit-specific routing is inferred.
- Sources publish no separate visiting hours for the nine ÖGK regional administrations. Their customer-service offices have their own opening hours and records.
- `verified_at` is omitted in every record pending human review. No schema, application code or dependency changed.

## Checked URLs and verbatim quotes

### https://auva.at/Servicestellen/

Records: discovery / source review only.

> Servicestellen

### https://auva.at/servicestellen/auvb

Records: discovery / source review only.

> Die Allgemeine Unfallversicherungs-Betriebsgesellschaft m.b.H. (AUVB) bietet Dienstleistungen in den Bereichen Facility Management und Immobilienmanagement. So sorgt sie tagtäglich für einen reibungslosen Betrieb aller Einrichtungen der AUVA.

### https://auva.at/servicestellen/competence-center-berufskrankheiten

Records: discovery / source review only.

> Wenn der Verdacht auf das Vorliegen einer Berufskrankheit gemeldet wurde, übernimmt die AUVA die stationären und ambulanten Begutachtungen. Dafür benötigen wir eine Meldung einer Berufskrankheit.

### https://auva.at/servicestellen/hauptstelle

Records: `auva-hauptstelle`.

> Allgemeine Unfallversicherungsanstalt (AUVA)
> +43 5 93 93-20000
> +43 5 93 93-20606
> Wienerbergstraße 11, 1100 Wien

> kontakt@auva.at

> Die AUVA-Kundendienststellen sind wochentags (Mo - Fr) von 07:00 bis 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 bis 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

> Die Hauptstelle in Wien hat zentrale und koordinierende Funktionen in der Unternehmensstrategie, der Datenverarbeitung, der Forschung, im Rechts- und Leistungswesen, im Personal- und Finanzwesen und in der Öffentlichkeitsarbeit.

### https://auva.at/servicestellen/landesstelle-graz

Records: `auva-landesstelle-graz`.

> Landesstelle Graz
> Direktion
> GLD@auva.at
> +43 5 93 93-33000
> +43 5 93 93-33609
> Göstinger Straße 26, 8020 Graz

> Die AUVA-Kunden-:Kundinnendienststellen sind wochentags (Mo - Fr) von 07:00 - 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 - 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

> Die AUVA-Landesstelle Graz ist Steiermark und Kärnten zuständig.

### https://auva.at/servicestellen/landesstelle-graz/aussenstelle-klagenfurt

Records: `auva-aussenstelle-klagenfurt`.

> Außenstelle Klagenfurt
> Allgemeine Unfallversicherungsanstalt
> Waidmannsdorferstrasse 42, 9020 Klagenfurt
> Leistungsabteilung
> AK@auva.at
> +43 5 93 93-33833

> Die AUVA-Kundendienststellen sind wochentags (Mo - Fr) von 07:00 bis 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 bis 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

### https://auva.at/servicestellen/landesstelle-linz

Records: `auva-landesstelle-linz`.

> Landesstelle Linz
> Direktion
> LLD@auva.at
> +43 5 93 93-32000
> +43 5 93 93-32380
> Garnisonstraße 5, 4010 Linz

> Die AUVA-Kunden-:Kundinnendienststellen sind wochentags (Mo - Fr) von 07:00 - 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 - 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

> Die AUVA-Landesstelle Linz ist für das Land Oberösterreich zuständig.

### https://auva.at/servicestellen/landesstelle-salzburg

Records: `auva-landesstelle-salzburg`.

> Landesstelle Salzburg
> Direktion
> SLD@auva.at
> +43 5 93 93-34000
> +43 5 93 93-34615
> Dr.-Franz-Rehrl-Platz 5, 5010 Salzburg

> Die AUVA-Kunden-:Kundinnendienststellen sind wochentags (Mo - Fr) von 07:00 - 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 - 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

> Die AUVA-Landesstelle Salzburg ist für die Länder Salzburg, Tirol und Vorarlberg zuständig.

### https://auva.at/servicestellen/landesstelle-salzburg/aussenstelle-dornbirn

Records: `auva-aussenstelle-dornbirn`.

> Außenstelle Dornbirn
> Allgemeine Unfallversicherungsanstalt
> Eisengasse 12, 6850 Dornbirn
> Leistungsabteilung
> AD@auva.at
> +43 5 93 93-34901

> Die AUVA-Kundendienststellen sind wochentags (Mo - Fr) von 07:00 bis 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 bis 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

### https://auva.at/servicestellen/landesstelle-salzburg/aussenstelle-innsbruck

Records: `auva-aussenstelle-innsbruck`.

> Außenstelle Innsbruck
> Allgemeine Unfallversicherungsanstalt
> Ing.-Etzel-Straße 17, 6020 Innsbruck
> Leistungsabteilung
> AI@auva.at
> +43 5 93 93-34801

> Die AUVA-Kundendienststellen sind wochentags (Mo - Fr) von 07:00 bis 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 bis 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

### https://auva.at/servicestellen/landesstelle-wien

Records: `auva-landesstelle-wien`.

> Landesstelle Wien
> Direktion
> WLD@auva.at
> +43 5 93 93-31000
> +43 5 93 93-31191
> Wienerbergstraße 11 , 1100 Wien

> Die AUVA-Kunden-:Kundinnendienststellen sind wochentags (Mo – Fr) von 07:00 bis 16:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Mo – Do von 07:30 bis 16:00 Uhr und Fr von 07:30 bis 15:15 sind wir auch ohne Terminvereinbarung persönlich erreichbar.

> Die AUVA-Landesstelle Wien ist für die Länder Wien, Niederösterreich und Burgenland zuständig.

### https://auva.at/servicestellen/landesstelle-wien/aussenstelle-oberwart

Records: `auva-aussenstelle-oberwart`.

> Außenstelle Oberwart
> Allgemeine Unfallversicherungsanstalt
> AO@auva.at
> +43 5 93 93-31901
> +43 5 93 93-31930
> Hauptplatz 11, 7400 Oberwart

> Die AUVA-Kundendienststellen sind wochentags (Mo - Fr) von 07:00 bis 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 bis 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

### https://auva.at/servicestellen/landesstelle-wien/aussenstelle-st-poelten

Records: `auva-aussenstelle-st-poelten`.

> Außenstelle St. Pölten
> Allgemeine Unfallversicherungsanstalt
> AS@auva.at
> +43 5 93 93-31888
> +43 5 93 93-31846
> Kremser Landstraße 8, 3100 St. Pölten

> Die AUVA-Kundendienststellen sind wochentags (Mo - Fr) von 07:00 bis 18:00 Uhr geöffnet. Bitte vereinbaren Sie vorab einen Termin - siehe oben stehende Telefonnummer.
> Wochentags (Mo - Fr) von 08:00 bis 15:00 Uhr sind wir auch ohne Terminvereinbarung persönlich erreichbar.

### https://auva.at/servicestellen/oesterreichische-staubbekaempfungsstelle-oesbs

Records: discovery / source review only.

> Die Österreichische Staub-(Silikose-­)Bekämpfungsstelle ist eine Prüfstelle für Staubschutzeinrichtungen, Staubschutzmaßnahmen und gesundheitsgefährdende Stoffe. Die Prüfstelle ist akkreditiert nach EN ISO/IEC 17025 durch das Bundesministerium für Wirtschaft und Arbeit unter der Registrierungsnummer 92.714/5431-I/12/2004.

### https://auva.at/servicestellen/oesterreichische-staubbekaempfungsstelle-oesbs/pruefstelle

Records: discovery / source review only.

> Die Prüfstelle für Staubschutzeinrichtungen ist der Österreichischen Staubbekämpfungsstelle (ÖSBS) angegliedert. Sie ist zur Ausstellung von international anerkannten Urkunden berechtigt. Ihre zentralen Themen sind Staubschutzeinrichtungen, Staubschutzmaßnahmen und gesundheitsgefährdende Stoffe.

### https://auva.at/servicestellen/oesterreichische-staubbekaempfungsstelle-oesbs/technische-abteilung

Records: discovery / source review only.

> Messung der Konzentration von luftverunreinigenden Stoffen an Arbeitsplätzen und in Räumen

### https://auva.at/servicestellen/sicherheitstechnische-pruefstelle-stp

Records: discovery / source review only.

> Die Sicherheitstechnische Prüfstelle (STP) ist eine nach dem Akkreditierungsgesetz akkreditierte Prüfstelle sowie Zertifizierungsstelle für Produkte und Personen (Konformitätsbewertungsstelle nach ISO 17025, ISO 17065 sowie ISO 17024).

### https://auva.at/servicestellen/sicherheitstechnische-pruefstelle-stp/personenzertifizierung

Records: discovery / source review only.

> Die Vergabe des Zertifikates setzt eine erfolgreich absolvierte Fachausbildung für Sicherheitsfachkräfte bei einer ermächtigten Ausbildungsorganisation voraus.

### https://auva.at/servicestellen/sicherheitstechnische-pruefstelle-stp/produktzertifizierung

Records: discovery / source review only.

> Im Bereich der Produktzertifizierung umfasst der Zertifizierungsumfang der Sicherheitstechnischen Prüfstelle (STP):

### https://auva.at/servicestellen/sicherheitstechnische-pruefstelle-stp/pruefungen

Records: discovery / source review only.

> Die Prüfstelle der STP prüft Produkte (persönliche Schutzausrüstung) hinsichtlich EN- sowie ANSI-Normen und misst Explosionsgrößen von Stäuben.

### https://auva.at/servicestellen/statistik

Records: discovery / source review only.

> Vom groben Überblick bis zum feinsten Detail – das Statistik-Team der AUVA verwandelt Daten über Arbeitsunfälle, Berufskrankheiten und Renten in anschauliche Informationen.

### https://www.bvaeb.at/cdscontent/?contentid=10007.854342&portal=bvaebbportal

Records: `bvaeb-burgenland`, `bvaeb-kaernten`, `bvaeb-niederoesterreich`, `bvaeb-oberoesterreich`, `bvaeb-salzburg`, `bvaeb-steiermark`, `bvaeb-tirol`, `bvaeb-vorarlberg`, `bvaeb-wien`, `bvaeb-oberoesterreich-bahnhofplatz`.

> ast.eisenstadt@bvaeb.at

> lst.kaernten@bvaeb.at

> ast.stpoelten@bvaeb.at

> lst.oberoesterreich@bvaeb.at

> lst.salzburg@bvaeb.at

> lst.steiermark@bvaeb.at

> lst.tirol@bvaeb.at

> lst.vorarlberg@bvaeb.at

> postoffice@bvaeb.at

> Landesstelle für Oberösterreich
> Hessenplatz 14
> 4020 Linz
> oder
> Bahnhofplatz 3-6
> 4020 Linz
> 050405-24700
> lst.oberoesterreich@bvaeb.at

> Öffnungszeiten:
> Montag - Donnerstag von 8-14 Uhr
> Freitag von 8-13 Uhr

### https://www.bvaeb.at/cdscontent/?contentid=10007.854344

Records: discovery / source review only.

> Die BVAEB verfügt über ein umfangreiches Netz an Kundenservicestellen, Gesundheitseinrichtungen und Ambulatorien in ganz Österreich.

### https://www.bvaeb.at/cdscontent/?contentid=10007.855051&portal=bvaebbportal

Records: `bvaeb-hauptstelle`.

> Versicherungsanstalt öffentlich Bediensteter, Eisenbahnen und Bergbau (BVAEB)
> Josefstädter Straße 80
> 1080 Wien
> 050405
> postoffice@bvaeb.at

### https://www.bvaeb.at/cdscontent/?contentid=10007.856918&portal=bvaebbportal

Records: `bvaeb-wien`.

> Landesstelle für
> Wien, NÖ und Burgenland
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-23700
> e-Mail: Diese finden Sie untenstehend je Fachbereich
> Standort
> Josefstädter Straße 80, 1080 Wien
> Josefstädter Straße 80, 1080 Wien

> Leistungsauskunft & Bewilligungen

### https://www.bvaeb.at/cdscontent/?contentid=10007.857145&portal=bvaebbportal

Records: `bvaeb-steiermark`.

> Landesstelle für
> Steiermark
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-25700
> e-Mail: Diese finden Sie untenstehend je Fachbereich
> Standorte
> Grieskai 106, 8020 Graz
> Grieskai 106, 8020 Graz

> Leistungsauskunft & Bewilligungen

### https://www.bvaeb.at/cdscontent/?contentid=10007.857150&portal=bvaebbportal

Records: `bvaeb-oberoesterreich`.

> Landesstelle für
> Oberösterreich
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-24700
> e-Mail: Diese finden Sie untenstehend je Fachbereich
> Standorte
> Hessenplatz 14, 4020 Linz
> Hessenplatz 14, 4020 Linz

> Leistungsauskunft & Bewilligungen

### https://www.bvaeb.at/cdscontent/?contentid=10007.857152&portal=bvaebbportal

Records: `bvaeb-salzburg`.

> Landesstelle für
> Salzburg
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-27700
> e-Mail: Diese finden Sie untenstehend je Fachbereich
> Standort
> St.-Julien-Straße 12A, 5020 Salzburg
> St.-Julien-Straße 12A, 5020 Salzburg

> Leistungsauskunft & Bewilligungen

### https://www.bvaeb.at/cdscontent/?contentid=10007.857155&portal=bvaebbportal

Records: `bvaeb-kaernten`.

> Landesstelle für
> Kärnten
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-26700
> e-Mail: Diese finden Sie untenstehend je Fachbereich
> Standorte
> Siebenhügelstraße 1, 9020 Klagenfurt am Wörthersee
> Siebenhügelstraße 1, 9020 Klagenfurt am Wörthersee

> Leistungsauskunft & Bewilligungen

### https://www.bvaeb.at/cdscontent/?contentid=10007.857184&portal=bvaebbportal

Records: `bvaeb-tirol`.

> Landesstelle für Tirol
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-28700
> e-Mail: Diese finden Sie untenstehend je Fachbereich
> Standort
> Meinhardstraße 1, 6010 Innsbruck
> Meinhardstraße 1, 6010 Innsbruck

> Leistungsauskunft & Bewilligungen

### https://www.bvaeb.at/cdscontent/?contentid=10007.857186&portal=bvaebbportal

Records: `bvaeb-vorarlberg`.

> Landesstelle für
> Vorarlberg
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-29700
> e-Mail: Diese finden Sie untenstehend je Fachbereich
> Standort
> Montfortstraße 11, 6900 Bregenz
> Montfortstraße 11, 6900 Bregenz

> Leistungsauskunft & Bewilligungen

### https://www.bvaeb.at/cdscontent/?contentid=10007.859048&portal=bvaebbportal

Records: `bvaeb-niederoesterreich`.

> Außenstelle St. Pölten
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-23700
> e-Mail: Diese finden Sie untenstehend je Fachbereich
> Standort
> Bahnhofplatz 10, 3100 St.Pölten
> Bahnhofplatz 10, 3100 St. Pölten

> Leistungsauskunft & Bewilligungen

### https://www.bvaeb.at/cdscontent/?contentid=10007.859049&portal=bvaebbportal

Records: `bvaeb-burgenland`.

> Außenstelle Eisenstadt
> Öffnungszeiten:
> Montag-Donnerstag 8:00-14:00 Uhr
> Freitag 8:00-13:00 Uhr
> Telefonische Erreichbarkeit (Service-Center):
> Montag-Donnerstag 7:00-16:00 Uhr
> Freitag 7:00-14:00 Uhr
> Telefon: 050405-23700
> e-Mail: Diesen finden Sie untenstehend je Fachbereich
> Standort
> Neusiedler Straße 10, 7000 Eisenstadt
> Neusiedler Straße 10, 7000 Eisenstadt

> Leistungsauskunft & Bewilligungen

### https://www.oegk.at/cdscontent/?contentid=10007.869522

Records: discovery / source review only.

> Die Österreichische Gesundheitskasse ist überall im Land für Sie da – und immer in Ihrer Nähe. Hier finden Sie unsere Kundenservicestellen auf einen Blick.

### https://www.oegk.at/cdscontent/?contentid=10007.870674&portal=oegkportal

Records: `oegk-kundenservice-wien-wienerberg`.

> Kundenservice Wienerberg
> Wienerbergstraße 15-19, EG
> 1100 Wien
> Telefon: +43 5 0766-11
> E-Mail: wienerberg@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

### https://www.oegk.at/cdscontent/?contentid=10007.878901&portal=oegkportal

Records: `oegk-burgenland`, `oegk-kaernten`, `oegk-niederoesterreich`, `oegk-oberoesterreich`, `oegk-salzburg`, `oegk-steiermark`, `oegk-tirol`, `oegk-vorarlberg`, `oegk-wien`.

> Österreichische Gesundheitskasse Burgenland
> Siegfried Marcus-Straße 5
> 7000 Eisenstadt
> Tel. +43 5 0766-13

> Österreichische Gesundheitskasse: office@oegk.at

> Österreichische Gesundheitskasse Kärnten
> Kempfstraße 8
> 9021 Klagenfurt am Wörthersee
> Tel. +43 5 0766-16

> Österreichische Gesundheitskasse Niederösterreich
> Kremser Landstraße 3
> 3100 St. Pölten
> Tel. +43 5 0766-12

> Österreichische Gesundheitskasse Oberösterreich
> Gruberstraße 77
> Postfach 61
> 4021 Linz
> Tel. +43 5 0766-14

> Österreichische Gesundheitskasse Salzburg
> Engelbert-Weiß-Weg 10
> 5020 Salzburg
> Tel. +43 5 0766-17

> Österreichische Gesundheitskasse Steiermark
> Josef-Pongratz-Platz 1
> 8010 Graz
> Tel. +43 5 0766-15

> Österreichische Gesundheitskasse Tirol
> Klara-Pölt-Weg 2
> 6020 Innsbruck
> Tel. +43 5 0766-18

> Österreichische Gesundheitskasse Vorarlberg
> Jahngasse 4
> 6850 Dornbirn
> Tel. +43 5 0766-19

> Österreichische Gesundheitskasse Wien
> Wienerbergstraße 15-19
> 1100 Wien
> Tel. +43 5 0766-11

### https://www.oegk.at/cdscontent/?contentid=10007.882872&portal=oegkportal

Records: `oegk-kundenservice-amstetten`.

> Kundenservice Amstetten
> Anzengruberstraße 8
> 3300 Amstetten
> Telefon: +43 5 0766-126100
> E-Mail: amstetten@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882873&portal=oegkportal

Records: `oegk-kundenservice-baden`.

> Kundenservice Baden
> Vöslauer Straße 14
> 2500 Baden
> Telefon: +43 5 0766-126100
> E-Mail: baden@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882874&portal=oegkportal

Records: `oegk-kundenservice-bruck-leitha`.

> Kundenservice Bruck/Leitha
> Stefaniegasse 4
> 2460 Bruck/Leitha
> Telefon: +43 5 0766-126100
> E-Mail: bruckleitha@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882875&portal=oegkportal

Records: `oegk-kundenservice-waidhofen-thaya`.

> Kundenservice Waidhofen/Thaya
> Raiffeisenpromenade 2E/1b
> 3830 Waidhofen/Thaya
> Telefon: +43 5 0766-126100
> E-Mail: waidhofenthaya@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882876&portal=oegkportal

Records: `oegk-kundenservice-mistelbach`.

> Kundenservice Mistelbach
> Roseggerstraße 46
> 2130 Mistelbach
> Telefon: +43 5 0766-126100
> E-Mail: mistelbach@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882877&portal=oegkportal

Records: `oegk-kundenservice-gaenserndorf`.

> Kundenservice Gänserndorf
> Umfahrungsstraße Nord 3
> 2230 Gänserndorf
> Telefon: +43 5 0766-126100
> E-Mail: gaenserndorf@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882878&portal=oegkportal

Records: `oegk-kundenservice-waidhofen-ybbs`.

> Kundenservice Waidhofen/Ybbs
> Zelinkagasse 19
> 3340 Waidhofen/Ybbs
> Telefon: +43 5 0766-126100
> E-Mail: waidhofenybbs@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882879&portal=oegkportal

Records: `oegk-kundenservice-st-poelten`.

> Kundenservice St.Pölten
> Kremser Landstraße 3, Verwaltung im Erdgeschoß der Hauptstelle
> 3100 St. Pölten
> Telefon: +43 5 0766-126100
> E-Mail: stpoelten@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882880&portal=oegkportal

Records: `oegk-kundenservice-moedling`.

> Kundenservice Mödling
> Josef-Schleussner-Straße 4
> 2340 Mödling
> Telefon: +43 5 0766-126100
> E-Mail: moedling@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882881&portal=oegkportal

Records: `oegk-kundenservice-klosterneuburg`.

> Kundenservice Klosterneuburg
> Hermannstraße 6
> 3400 Klosterneuburg
> Telefon: +43 5 0766-126100
> E-Mail: klosterneuburg@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882882&portal=oegkportal

Records: `oegk-kundenservice-krems`.

> Kundenservice Krems
> Dr.-Josef-Maria-Eder-Gasse 3
> 3500 Krems
> Telefon: +43 5 0766-126100
> E-Mail: krems@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882883&portal=oegkportal

Records: `oegk-kundenservice-hollabrunn`.

> Kundenservice Hollabrunn
> Pfarrgasse 11
> 2020 Hollabrunn
> Telefon: +43 5 0766-126100
> E-Mail: hollabrunn@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882884&portal=oegkportal

Records: `oegk-kundenservice-gmuend`.

> Kundenservice Gmünd
> Hamerlinggasse 25
> 3950 Gmünd
> Telefon: +43 5 0766-126100
> E-Mail: gmuend@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882885&portal=oegkportal

Records: `oegk-kundenservice-wr-neustadt`.

> Kundenservice Wr. Neustadt
> Wiener Straße 69
> 2700 Wr. Neustadt
> Telefon: +43 5 0766-126100
> E-Mail: wrneustadt@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882886&portal=oegkportal

Records: `oegk-kundenservice-stockerau`.

> Kundenservice Stockerau
> Parkgasse 17
> 2000 Stockerau
> Telefon: +43 5 0766-126100
> E-Mail: stockerau@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882887&portal=oegkportal

Records: `oegk-kundenservice-scheibbs`.

> Kundenservice Scheibbs
> Bahngasse 1
> 3270 Scheibbs
> Telefon: +43 5 0766-126100
> E-Mail: scheibbs@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882888&portal=oegkportal

Records: `oegk-kundenservice-poechlarn`.

> Kundenservice Pöchlarn
> Regensburgerstraße 21
> 3380 Pöchlarn
> Telefon: +43 5 0766-126100
> E-Mail: poechlarn@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882889&portal=oegkportal

Records: `oegk-kundenservice-neunkirchen`.

> Kundenservice Neunkirchen
> Stockhammergasse 23
> 2620 Neunkirchen
> Telefon: +43 5 0766-126100
> E-Mail: neunkirchen@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882890&portal=oegkportal

Records: `oegk-kundenservice-schwechat`.

> Kundenservice Schwechat
> Sendnergasse 9
> 2320 Schwechat
> Telefon: +43 5 0766-126100
> E-Mail: schwechat@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882891&portal=oegkportal

Records: `oegk-kundenservice-tulln`.

> Kundenservice Tulln
> Zeiselweg 2-6
> 3430 Tulln
> Telefon: +43 5 0766-126100
> E-Mail: tulln@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882892&portal=oegkportal

Records: `oegk-kundenservice-lilienfeld`.

> Kundenservice Lilienfeld
> Liese Prokop Straße 11
> 3180 Lilienfeld
> Telefon: +43 5 0766-126100
> E-Mail: lilienfeld@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882893&portal=oegkportal

Records: `oegk-kundenservice-zwettl`.

> Kundenservice Zwettl
> Weitraer Straße 15
> 3910 Zwettl
> Telefon: +43 5 0766-126100
> E-Mail: zwettl@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882894&portal=oegkportal

Records: `oegk-kundenservice-korneuburg`.

> Kundenservice Korneuburg
> Bankmannring 22
> 2100 Korneuburg
> Telefon: +43 5 0766-126100
> E-Mail: korneuburg@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882895&portal=oegkportal

Records: `oegk-kundenservice-horn`.

> Kundenservice Horn
> Hopfengartenstraße 21/2
> 3580 Horn
> Telefon: +43 5 0766-126100
> E-Mail: horn@oegk.at

> Montag:07.30 – 14.30
> Dienstag:07.30 – 14.30
> Mittwoch:07.30 – 14.30
> Donnerstag:07.30 – 14.30
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882898&portal=oegkportal

Records: `oegk-kundenservice-ebensee`.

> Kundenservice Ebensee
> Hauptstraße 34
> 4802 Ebensee
> Telefon: +43 5 0766-14383970
> E-Mail: badischl@oegk.at

> Mittwoch:08.00 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882899&portal=oegkportal

Records: `oegk-kundenservice-bad-goisern`.

> Kundenservice Bad Goisern
> Untere Marktstraße 1
> 4822 Bad Goisern
> Telefon: +43 5 0766-14383970
> E-Mail: badischl@oegk.at

> Dienstag:10.00 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882900&portal=oegkportal

Records: `oegk-kundenservice-bad-hall`.

> Kundenservice Bad Hall
> Kirchenstraße 11
> 4540 Bad Hall
> Telefon: +43 5 0766-14113900
> E-Mail: badhall@oegk.at

> Montag:07.30 – 12.00
> Dienstag:07.30 – 12.00
> Mittwoch:07.30 – 12.00
> Donnerstag:07.30 – 12.00
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882901&portal=oegkportal

Records: `oegk-kundenservice-bad-ischl`.

> Kundenservice Bad Ischl
> Bahnhofstraße 12
> 4820 Bad Ischl
> Telefon: +43 5 0766-14383900
> E-Mail: badischl@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882902&portal=oegkportal

Records: `oegk-kundenservice-oberpullendorf`.

> Kundenservice Oberpullendorf
> Gymnasiumstraße 15
> 7350 Oberpullendorf
> Telefon: +43 5 0766-133400
> E-Mail: oberpullendorf@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882903&portal=oegkportal

Records: `oegk-kundenservice-oberwart`.

> Kundenservice Oberwart
> Waldmüllergasse, 1/1
> 7400 Oberwart
> Telefon: +43 5 0766-133500
> E-Mail: oberwart@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882904&portal=oegkportal

Records: `oegk-kundenservice-eisenstadt`.

> Kundenservice Eisenstadt
> Siegfried-Marcus-Straße 5
> 7000 Eisenstadt
> Telefon: +43 5 0766-13
> E-Mail: eisenstadt@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882905&portal=oegkportal

Records: `oegk-kundenservice-jennersdorf`.

> Kundenservice Jennersdorf
> Bahnhofring 5
> 8380 Jennersdorf
> Telefon: +43 5 0766-133700
> E-Mail: jennersdorf@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882906&portal=oegkportal

Records: `oegk-kundenservice-neusiedl-see`.

> Kundenservice Neusiedl/See
> Gartenweg 26
> 7100 Neusiedl/See
> Telefon: +43 5 0766-133200
> E-Mail: neusiedl@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882908&portal=oegkportal

Records: `oegk-kundenservice-guessing`.

> Kundenservice Güssing
> Hauptplatz 1
> 7540 Güssing
> Telefon: +43 5 0766-133600
> E-Mail: guessing@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882910&portal=oegkportal

Records: `oegk-kundenservice-wien-doebling`.

> Kundenservice Döbling
> Heiligenstädter Straße 31
> 1190 Wien
> Telefon: +43 5 0766-118000
> E-Mail: doebling@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882911&portal=oegkportal

Records: `oegk-kundenservice-wien-mariahilf`.

> Kundenservice Mariahilf
> Mariahilfer Straße 85-87
> 1060 Wien
> Telefon: +43 5 0766-118000
> E-Mail: mariahilf@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882913&portal=oegkportal

Records: `oegk-kundenservice-wien-floridsdorf`.

> Kundenservice Floridsdorf
> Franz-Jonas-Platz 11
> 1210 Wien
> Telefon: +43 5 0766-118000
> E-Mail: floridsdorf@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882914&portal=oegkportal

Records: `oegk-kundenservice-wien-leopoldstadt`.

> Kundenservice Leopoldstadt
> Lassallestraße 9b
> 1020 Wien
> Telefon: +43 5 0766-118000
> E-Mail: leopoldstadt@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882916&portal=oegkportal

Records: `oegk-kundenservice-wien-aspern`.

> Kundenservice Aspern
> Erzherzog-Karl-Straße 250
> 1220 Wien
> Telefon: +43 5 0766-118000
> E-Mail: aspern@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882917&portal=oegkportal

Records: `oegk-kundenservice-wien-penzing`.

> Kundenservice Penzing
> Hütteldorfer Straße 112
> 1140 Wien
> Telefon: +43 5 0766-118000
> E-Mail: penzing@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882918&portal=oegkportal

Records: `oegk-kundenservice-wien-favoriten`.

> Kundenservice Favoriten
> Ada-Christengasse 12
> 1100 Wien
> Telefon: +43 5 0766-118000
> E-Mail: favoriten@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882919&portal=oegkportal

Records: `oegk-kundenservice-wien-simmering`.

> Kundenservice Simmering
> Guglgasse 8, Gasometer B
> 1110 Wien
> Telefon: +43 5 0766-118000
> E-Mail: simmering@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882920&portal=oegkportal

Records: `oegk-kundenservice-wien-kagran`.

> Kundenservice Kagran
> Kagraner Platz 1, 1. OG
> 1220 Wien
> Telefon: +43 5 0766-118000
> E-Mail: kagran@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882921&portal=oegkportal

Records: `oegk-kundenservice-wien-kinderbetreuungsgeld`.

> Kundenservice Kinderbetreuungsgeld Wien
> Kagraner Platz 1, 1. OG
> 1220 Wien
> Telefon: +43 5 0766-1114070
> E-Mail: kckbg@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882922&portal=oegkportal

Records: `oegk-kundenservice-wien-meidling`.

> Kundenservice Meidling
> Schönbrunner Schloßstraße 2, Vio Plaza, 2. OG
> 1120 Wien
> Telefon: +43 5 0766-118000
> E-Mail: meidling@oegk.at

> Montag:07.00 – 14.30
> Dienstag:07.00 – 14.30
> Mittwoch:07.00 – 14.30
> Donnerstag:07.00 – 14.30
> Freitag:07.00 – 14.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882925&portal=oegkportal

Records: `oegk-kundenservice-bad-leonfelden`.

> Kundenservice Bad Leonfelden
> Ringstraße 77, Haus am Ring
> 4190 Bad Leonfelden
> Telefon: +43 5 0766-14243970
> E-Mail: urfahr@oegk.at

> Donnerstag:08.00 – 12.00 / 13.00 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882926&portal=oegkportal

Records: `oegk-kundenservice-braunau`.

> Kundenservice Braunau
> Jahnstraße 1
> 5280 Braunau am Inn
> Telefon: +43 5 0766-14393900
> E-Mail: braunau@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882927&portal=oegkportal

Records: `oegk-kundenservice-eferding`.

> Kundenservice Eferding
> Stephan-Fadinger-Straße 4
> 4070 Eferding
> Telefon: +43 5 0766-14143900
> E-Mail: eferding@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882928&portal=oegkportal

Records: `oegk-kundenservice-enns`.

> Kundenservice Enns
> Linzer Straße 21
> 4470 Enns
> Telefon: +43 5 0766-14153900
> E-Mail: enns@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882929&portal=oegkportal

Records: `oegk-kundenservice-freistadt`.

> Kundenservice Freistadt
> St. Peter Straße 6
> 4240 Freistadt
> Telefon: +43 5 0766-14163900
> E-Mail: freistadt@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882930&portal=oegkportal

Records: `oegk-kundenservice-gallneukirchen`.

> Kundenservice Gallneukirchen
> Reichenauerstraße 1a, 1. OG
> 4210 Gallneukirchen
> Telefon: +43 5 0766-14243970
> E-Mail: urfahr@oegk.at

> Jeden ersten und dritten Dienstag im Monat von 10.00 - 12.00 Uhr.
> Im August geschlossen!

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882931&portal=oegkportal

Records: `oegk-kundenservice-gmunden`.

> Kundenservice Gmunden
> Miller-von-Aichholz-Straße 46
> 4810 Gmunden
> Telefon: +43 5 0766-14173900
> E-Mail: gmunden@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882932&portal=oegkportal

Records: `oegk-kundenservice-gosau`.

> Kundenservice Gosau
> Vordertalstraße 30
> 4824 Gosau
> Telefon: +43 5 0766-14383970
> E-Mail: badischl@oegk.at

> Dienstag:07.30 – 09.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882933&portal=oegkportal

Records: `oegk-kundenservice-grein`.

> Kundenservice Grein
> Rathausgasse 1 (Stadtamt)
> 4360 Grein
> Telefon: +43 5 0766-14273970
> E-Mail: perg@oegk.at

> Mittwoch:08.00 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882934&portal=oegkportal

Records: `oegk-kundenservice-grieskirchen`.

> Kundenservice Grieskirchen
> Trattnach-Arkade 1
> 4710 Grieskirchen
> Telefon: +43 5 0766-14183900
> E-Mail: grieskirchen@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882936&portal=oegkportal

Records: `oegk-kundenservice-grossraming`.

> Kundenservice Großraming
> Kirchenplatz 1
> 4463 Großraming
> Telefon: +43 5 0766-14323970
> E-Mail: steyr@oegk.at

> Jeden ersten Donnerstag im Monat von 08.00 bis 10.00 Uhr.

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882937&portal=oegkportal

Records: `oegk-kundenservice-kirchdorf`.

> Kundenservice Kirchdorf
> Steiermärker Straße 30
> 4560 Kirchdorf/Krems
> Telefon: +43 5 0766-14193900
> E-Mail: kirchdorf@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882938&portal=oegkportal

Records: `oegk-kundenservice-kremsmuenster`.

> Kundenservice Kremsmünster
> Linzer-Straße 7
> 4550 Kremsmünster
> Telefon: +43 5 0766-14193970
> E-Mail: kirchdorf@oegk.at

> Derzeit geschlossen

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882940&portal=oegkportal

Records: `oegk-kundenservice-lambach`.

> Kundenservice Lambach
> Salzburger Straße 16
> 4650 Lambach
> Telefon: +43 5 0766-14203900
> E-Mail: lambach@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882942&portal=oegkportal

Records: `oegk-kundenservice-linz-kleinmuenchen`.

> Kundenservice Linz Kleinmünchen
> Zeppelinstraße 60
> 4030 Linz
> Telefon: +43 5 0766-14233700
> E-Mail: kleinmuenchen@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882943&portal=oegkportal

Records: `oegk-kundenservice-linz-urfahr`.

> Kundenservice Linz Urfahr
> Hauptstraße 16-18
> 4040 Linz
> Telefon: +43 5 0766-14243900
> E-Mail: urfahr@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882946&portal=oegkportal

Records: `oegk-kundenservice-linz-hauptstelle`.

> Kundenservice Linz
> Gruberstraße 77
> 4020 Linz
> Telefon: +43 5 0766-14
> E-Mail: linz@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882948&portal=oegkportal

Records: `oegk-kundenservice-losenstein`.

> Kundenservice Losenstein
> Eisenstraße 45, Gemeindeamt
> 4460 Losenstein
> Telefon: +43 5 0766-14323970
> E-Mail: steyr@oegk.at

> Jeden ersten Donnerstag im Monat von 10.30 bis 12.30 Uhr.

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882950&portal=oegkportal

Records: `oegk-kundenservice-mattighofen`.

> Kundenservice Mattighofen
> Brauereistraße 8a
> 5230 Mattighofen
> Telefon: +43 5 0766-14263900
> E-Mail: mattighofen@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882952&portal=oegkportal

Records: `oegk-kundenservice-mondsee`.

> Kundenservice Mondsee
> Kirchengasse 16
> 5310 Mondsee
> Telefon: +43 5 0766-14363970
> E-Mail: voecklabruck@oegk.at

> Mittwoch:06.45 – 12.00
> Freitag:06.45 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882954&portal=oegkportal

Records: `oegk-kundenservice-neuhofen-krems`.

> Kundenservice Neuhofen/Krems
> Sportallee 58, Forum Neuhofen
> 4501 Neuhofen/Krems
> Telefon: +43 5 0766-14353970
> E-Mail: traun@oegk.at

> Jeden ersten und dritten Dienstag im Monat: 07.00 bis 12.00 Uhr

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882956&portal=oegkportal

Records: `oegk-kundenservice-ostermiething`.

> Kundenservice Ostermiething
> Bergstraße 30
> 5121 Ostermiething
> Telefon: +43 5 0766-14393970
> E-Mail: braunau@oegk.at

> Jeden zweiten und vierten Donnerstag im Monat von 09.00 - 11.00 Uhr.

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882957&portal=oegkportal

Records: `oegk-kundenservice-perg`.

> Kundenservice Perg
> Gartenstraße 14
> 4320 Perg
> Telefon: +43 5 0766-14273900
> E-Mail: perg@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882958&portal=oegkportal

Records: `oegk-kundenservice-peuerbach`.

> Kundenservice Peuerbach
> Rathausplatz 1
> 4722 Peuerbach
> Telefon: +43 5 0766-14183970
> E-Mail: grieskirchen@oegk.at

> Mittwoch:07.30 – 11.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882959&portal=oegkportal

Records: `oegk-kundenservice-ried`.

> Kundenservice Ried
> Marktplatz 3
> 4910 Ried
> Telefon: +43 5 0766-14293900
> E-Mail: ried@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882960&portal=oegkportal

Records: `oegk-kundenservice-pregarten`.

> Kundenservice Pregarten
> Tragweiner Straße 29
> 4230 Pregarten
> Telefon: +43 5 0766-14283900
> E-Mail: pregarten@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882969&portal=oegkportal

Records: `oegk-kundenservice-wolfsberg`.

> Kundenservice Wolfsberg
> Roßmarkt 13
> 9400 Wolfsberg
> Telefon: +43 5 0766-164800
> E-Mail: wolfsberg@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 12.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882970&portal=oegkportal

Records: `oegk-kundenservice-klagenfurt`.

> Kundenservice Klagenfurt
> Kempfstraße 8
> 9020 Klagenfurt
> Telefon: +43 5 0766-161000 (Vermittlung)
> Telefon: +43 5 0766-163100 (Kundenservice)
> E-Mail: klagenfurt@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882971&portal=oegkportal

Records: `oegk-kundenservice-voelkermarkt`.

> Kundenservice Völkermarkt
> Seenstraße, 2
> 9100 Völkermarkt
> Telefon: +43 5 0766-164700
> E-Mail: voelkermarkt@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 12.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882972&portal=oegkportal

Records: `oegk-kundenservice-hermagor`.

> Kundenservice Hermagor
> Egger Straße 7
> 9620 Hermagor
> Telefon: +43 5 0766-164300
> E-Mail: hermagor@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 12.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882973&portal=oegkportal

Records: `oegk-kundenservice-st-veit-glan`.

> Kundenservice St. Veit/Glan
> Platz am Graben 4
> 9300 St. Veit/Glan
> Telefon: +43 5 0766-164600
> E-Mail: stveit@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 12.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882974&portal=oegkportal

Records: `oegk-kundenservice-villach`.

> Kundenservice Villach
> Zeidler-von-Görz-Straße 3
> 9500 Villach
> Telefon: +43 5 0766-164400
> E-Mail: villach@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 12.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882975&portal=oegkportal

Records: `oegk-kundenservice-feldkirchen`.

> Kundenservice Feldkirchen
> 10. Oktober Straße 24
> 9560 Feldkirchen
> Telefon: +43 5 0766-164500
> E-Mail: feldkirchen@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 12.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882976&portal=oegkportal

Records: `oegk-kundenservice-spittal-drau`.

> Kundenservice Spittal/Drau
> Feldstraße 1
> 9800 Spittal/Drau
> Telefon: +43 5 0766-164200
> E-Mail: spittal@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 12.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882978&portal=oegkportal

Records: `oegk-kundenservice-rohrbach`.

> Kundenservice Rohrbach
> Stadtplatz 16
> 4150 Rohrbach
> Telefon: +43 5 0766-14303900
> E-Mail: rohrbach@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882979&portal=oegkportal

Records: `oegk-kundenservice-steyr`.

> Kundenservice Steyr
> Sepp-Stöger-Straße 11
> 4400 Steyr
> Telefon: +43 5 0766-14323900
> E-Mail: steyr@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882980&portal=oegkportal

Records: `oegk-kundenservice-schwanenstadt`.

> Kundenservice Schwanenstadt
> Stadtplatz 54, Rathaus
> 4690 Schwanenstadt
> Telefon: +43 5 0766-14363970
> E-Mail: voecklabruck@oegk.at

> Donnerstag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882981&portal=oegkportal

Records: `oegk-kundenservice-schaerding`.

> Kundenservice Schärding
> Max-Hirschenauer-Straße 18
> 4780 Schärding
> Telefon: +43 5 0766-14313900
> E-Mail: schaerding@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882982&portal=oegkportal

Records: `oegk-kundenservice-steyregg`.

> Kundenservice Steyregg
> Weissenwolffstraße 3, 1. OG, Kleiner Sitzungssaal
> 4221 Steyregg
> Telefon: +43 5 0766-14243970
> E-Mail: urfahr@oegk.at

> Jeden ersten und dritten Dienstag im Monat von 08.00 - 09.00 Uhr.

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882983&portal=oegkportal

Records: `oegk-kundenservice-traun`.

> Kundenservice Traun
> Bahnhofstraße 15
> 4050 Traun
> Telefon: +43 5 0766-14353900
> E-Mail: traun@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882985&portal=oegkportal

Records: `oegk-kundenservice-zell-see`.

> Kundenservice Zell/See
> Ebenbergstraße 3
> 5700 Zell am See
> Telefon: +43 5 0766-178450
> E-Mail: zellamsee@oegk.at

> Montag:07.15 – 15.00
> Dienstag:07.15 – 15.00
> Mittwoch:07.15 – 15.00
> Donnerstag:07.15 – 15.00
> Freitag:07.15 – 12.15

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882986&portal=oegkportal

Records: `oegk-kundenservice-salzburg`.

> Kundenservice Salzburg
> Engelbert-Weiß-Weg 10
> 5020 Salzburg
> Telefon: +43 5 0766-17
> E-Mail: salzburg@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882987&portal=oegkportal

Records: `oegk-kundenservice-tamsweg`.

> Kundenservice Tamsweg
> Bahnhofstraße 7
> 5580 Tamsweg
> Telefon: +43 5 0766-178574
> E-Mail: tamsweg@oegk.at

> Montag:07.15 – 12.30 / 13.00 – 15.00
> Dienstag:07.15 – 12.30 / 13.00 – 15.00
> Mittwoch:07.15 – 12.30 / 13.00 – 15.00
> Donnerstag:07.15 – 12.30 / 13.00 – 15.00
> Freitag:07.15 – 12.15

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882988&portal=oegkportal

Records: `oegk-kundenservice-bischofshofen`.

> Kundenservice Bischofshofen
> Gasteinerstraße 29
> 5500 Bischofshofen
> Telefon: +43 5 0766-178300
> E-Mail: bischofshofen@oegk.at

> Montag:07.15 – 15.00
> Dienstag:07.15 – 15.00
> Mittwoch:07.15 – 15.00
> Donnerstag:07.15 – 15.00
> Freitag:07.15 – 12.15

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882989&portal=oegkportal

Records: `oegk-kundenservice-hallein`.

> Kundenservice Hallein
> Burgfriedstraße 2
> 5400 Hallein
> Telefon: +43 5 0766-178200
> E-Mail: hallein@oegk.at

> Montag:07.15 – 15.00
> Dienstag:07.15 – 15.00
> Mittwoch:07.15 – 15.00
> Donnerstag:07.15 – 15.00
> Freitag:07.15 – 12.15

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882990&portal=oegkportal

Records: `oegk-kundenservice-voecklabruck`.

> Kundenservice Vöcklabruck
> Franz Schubert-Straße 31
> 4840 Vöcklabruck
> Telefon: +43 5 0766-14363900
> E-Mail: voecklabruck@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882991&portal=oegkportal

Records: `oegk-kundenservice-windischgarsten`.

> Kundenservice Windischgarsten
> Hauptstraße 5, Gemeindeamt
> 4580 Windischgarsten
> Telefon: +43 5 0766-14193970
> E-Mail: kirchdorf@oegk.at

> Montag:08.00 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882992&portal=oegkportal

Records: `oegk-kundenservice-weyer`.

> Kundenservice Weyer
> Marktplatz 8
> 3335 Weyer
> Telefon: +43 5 0766-14323970
> E-Mail: steyr@oegk.at

> Mittwoch:08.00 – 12.00 / 13.00 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882993&portal=oegkportal

Records: `oegk-kundenservice-wels`.

> Kundenservice Wels
> Hans-Sachs-Straße 4
> 4600 Wels
> Telefon: +43 5 0766-14373900
> E-Mail: wels@oegk.at

> Montag:06.45 – 15.00
> Dienstag:06.45 – 15.00
> Mittwoch:06.45 – 15.00
> Donnerstag:06.45 – 15.00
> Freitag:06.45 – 15.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882994&portal=oegkportal

Records: `oegk-kundenservice-bad-aussee`.

> Kundenservice Bad Aussee
> Bahnhofstraße 237
> 8990 Bad Aussee
> Telefon: +43 5 0766-157777
> E-Mail: badaussee@oegk.at

> Dienstag:07.00 – 14.00
> Donnerstag:07.00 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882995&portal=oegkportal

Records: `oegk-kundenservice-kitzbuehel`.

> Kundenservice Kitzbühel
> Achenweg 16
> 6370 Kitzbühel
> Telefon: +43 5 0766-183812
> E-Mail: kitzbuehel@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882996&portal=oegkportal

Records: `oegk-kundenservice-dornbirn`.

> Kundenservice Dornbirn
> Jahngasse 4
> 6850 Dornbirn
> Telefon: +43 5 0766-19
> E-Mail: dornbirn@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882997&portal=oegkportal

Records: `oegk-kundenservice-schruns`.

> Kundenservice Schruns
> Veltlinerweg 5
> 6780 Schruns
> Telefon: +43 5 0766-196422
> E-Mail: schruns@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00
> Mittwoch:07.30 – 12.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882998&portal=oegkportal

Records: `oegk-kundenservice-hirschegg`.

> Kundenservice Hirschegg
> Walserstraße 260
> 6992 Hirschegg
> Telefon: +43 5 0766-195415
> E-Mail: hirschegg@oegk.at

> Dienstag:08.30 – 12.00 / 13.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.882999&portal=oegkportal

Records: `oegk-kundenservice-bregenz`.

> Kundenservice Bregenz
> Heldendankstraße 10
> 6900 Bregenz
> Telefon: +43 5 0766-192420
> E-Mail: bregenz@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00 / 13.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883001&portal=oegkportal

Records: `oegk-kundenservice-bludenz`.

> Kundenservice Bludenz
> Bahnhofstraße 12
> 6700 Bludenz
> Telefon: +43 5 0766-194420
> E-Mail: bludenz@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00 / 13.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883002&portal=oegkportal

Records: `oegk-kundenservice-egg`.

> Kundenservice Egg
> Loco 597
> 6863 Egg
> Telefon: +43 5 0766-195421
> E-Mail: egg@oegk.at

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00
> Mittwoch:07.30 – 12.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883003&portal=oegkportal

Records: `oegk-kundenservice-feldkirch`.

> Kundenservice Feldkirch
> Bahnhofstraße 30
> 6800 Feldkirch
> Telefon: +43 5 0766-193420
> E-Mail: feldkirch@oegk.at
> Öffnungszeiten
> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00 / 13.00 – 16.00
> Info für Besucher*innen
> Fertig ausgefüllte Schriftstücke (Anträge etc.) können Sie im Eingangsbereich in die gekennzeichnete Box einwerfen oder am Mein Check-in-Schalter abgeben. Für eine persönliche Beratung können Sie einen Termin online vereinbaren (siehe grüner Button oben). Nutzen Sie bitte auch unsere elektronischen Services auf meine.oegk.at.
> Fax-Ablöse bei der ÖGK
> Die Übermittlung sensibler Daten erfolgt nun über www.oegk.at/databox
> Unser Standort ist barrierefrei zugänglich.
> Medizinischer Dienst
> Kontakte und Öffnungszeiten finden Sie hier:
> Medizinischer Dienst Feldkirch
> Weitere Einrichtungen
> An diesem Standort befindet sich auch:
> Mein Zahngesundheitszentrum Feldkirch
> Österreichische Gesundheitskasse
> Wienerbergstraße 15-19
> 1100 Wien
> Tel. +43 5 0766-0
> IMPRESSUM
> DATENSCHUTZ
> BARRIEREFREIHEITS­ERKLÄRUNG
> TECHNISCHER SUPPORT
> ÜBER DIE ÖGK
> SITEMAP
> KONTAKT
> PRESSE
> JOBBÖRSE
> AUSSCHREIBUNGEN
> MEINE ÖGK-APP
> SV-TRÄGER
> SV-PARTNER
> ${c_name}
> ${description}
> Cookie-Einstellungen
> Diese Webseite verwendet Cookies für ein optimales Website-Erlebnis und für die anonyme Analyse des Online-Verhaltens der Besucherinnen und Besucher. Diese Analyse soll helfen, das Informationsangebot besser zu gestalten.
> Mehr Informationen finden Sie hier: Cookie-Erklärung / Datenschutz-Erklärung / Impressum
> Die Einstellung können Sie jederzeit auf der Seite "Cookie-Erklärung" ändern.
> Alle Cookies akzeptieren
> Nur essentielle Cookies akzeptieren
> Individuelle Einstellung einblenden
> Individuelle Einstellungen ausblenden
> Individuelle Einstellung speichern

> Montag:07.30 – 12.00 / 13.00 – 16.00
> Dienstag:07.30 – 12.00 / 13.00 – 16.00
> Mittwoch:07.30 – 12.00 / 13.00 – 16.00
> Donnerstag:07.30 – 12.00 / 13.00 – 16.00
> Freitag:07.30 – 12.00 / 13.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883004&portal=oegkportal

Records: `oegk-kundenservice-innsbruck`.

> Kundenservice Innsbruck
> Klara-Pölt-Weg 2
> 6020 Innsbruck
> Telefon: +43 5 0766-18
> E-Mail: innsbruck@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883005&portal=oegkportal

Records: `oegk-kundenservice-zell-ziller`.

> Kundenservice Zell/Ziller
> Aufeld 1b
> 6280 Zell/Ziller
> Telefon: +43 5 0766-183112
> E-Mail: zell@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883006&portal=oegkportal

Records: `oegk-kundenservice-landeck`.

> Kundenservice Landeck
> Fischerstraße 40
> 6500 Landeck
> Telefon: +43 5 0766-183412
> E-Mail: landeck@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883007&portal=oegkportal

Records: `oegk-kundenservice-telfs`.

> Kundenservice Telfs
> Untermarktstraße 48
> 6410 Telfs
> Telefon: +43 5 0766-183132
> E-Mail: telfs@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883008&portal=oegkportal

Records: `oegk-kundenservice-woergl`.

> Kundenservice Wörgl
> Poststraße 6c
> 6300 Wörgl
> Telefon: +43 5 0766-183612
> E-Mail: woergl@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883009&portal=oegkportal

Records: `oegk-kundenservice-kufstein`.

> Kundenservice Kufstein
> Kronthalerstraße 4
> 6330 Kufstein
> Telefon: +43 5 0766-183712
> E-Mail: kufstein@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883010&portal=oegkportal

Records: `oegk-kundenservice-reutte`.

> Kundenservice Reutte
> Dr. Machenschalk-Straße 1
> 6600 Reutte
> Telefon: +43 5 0766-183212
> E-Mail: reutte@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883011&portal=oegkportal

Records: `oegk-kundenservice-imst`.

> Kundenservice Imst
> Dr.-Carl-Pfeiffenberger-Straße 24
> 6460 Imst
> Telefon: +43 5 0766-183312
> E-Mail: imst@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883012&portal=oegkportal

Records: `oegk-kundenservice-lienz`.

> Kundenservice Lienz
> Bründlangerweg 1
> 9900 Lienz
> Telefon: +43 5 0766-183912
> E-Mail: lienz@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883013&portal=oegkportal

Records: `oegk-kundenservice-schwaz`.

> Kundenservice Schwaz
> Ullreichstraße 1a
> 6130 Schwaz
> Telefon: +43 5 0766-183512
> E-Mail: schwaz@oegk.at

> Montag:07.30 – 14.00
> Dienstag:07.30 – 14.00
> Mittwoch:07.30 – 14.00
> Donnerstag:07.30 – 14.00
> Freitag:07.30 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883148&portal=oegkportal

Records: `oegk-kundenservice-bruck-mur`.

> Kundenservice Bruck/Mur
> Dr.-Theodor-Körner-Straße 25
> 8600 Bruck/Mur
> Telefon: +43 5 0766-157777
> E-Mail: bruckmur@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883149&portal=oegkportal

Records: `oegk-kundenservice-deutschlandsberg`.

> Kundenservice Deutschlandsberg
> Fabrikstraße 10
> 8530 Deutschlandsberg
> Telefon: +43 5 0766-157777
> E-Mail: deutschlandsberg@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883151&portal=oegkportal

Records: `oegk-kundenservice-frohnleiten`.

> Kundenservice Frohnleiten
> Römerpark 3
> 8130 Frohnleiten
> Telefon: +43 5 0766-157777
> E-Mail: frohnleiten@oegk.at

> Dienstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883152&portal=oegkportal

Records: `oegk-kundenservice-feldbach`.

> Kundenservice Feldbach
> Ringstraße 25
> 8330 Feldbach
> Telefon: +43 5 0766-157777
> E-Mail: feldbach@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883153&portal=oegkportal

Records: `oegk-kundenservice-hartberg`.

> Kundenservice Hartberg
> Ressavarstraße 68
> 8230 Hartberg
> Telefon: +43 5 0766-157777
> E-Mail: hartberg@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883154&portal=oegkportal

Records: `oegk-kundenservice-fuerstenfeld`.

> Kundenservice Fürstenfeld
> Hauptplatz 12
> 8280 Fürstenfeld
> Telefon: +43 5 0766-157777
> E-Mail: fuerstenfeld@oegk.at

> Dienstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883156&portal=oegkportal

Records: `oegk-kundenservice-judenburg`.

> Kundenservice Judenburg
> Burggasse 118
> 8750 Judenburg
> Telefon: +43 5 0766-157777
> E-Mail: judenburg@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883157&portal=oegkportal

Records: `oegk-kundenservice-kapfenberg`.

> Kundenservice Kapfenberg
> Friedrich-Böhler-Straße 11
> 8605 Kapfenberg
> Telefon: +43 5 0766-157777
> E-Mail: kapfenberg@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883158&portal=oegkportal

Records: `oegk-kundenservice-kindberg`.

> Kundenservice Kindberg
> Vösendorfplatz 1
> 8650 Kindberg
> Telefon: +43 5 0766-157777
> E-Mail: kindberg@oegk.at

> Donnerstag:08.00 – 12.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883181&portal=oegkportal

Records: `oegk-kundenservice-trofaiach`.

> Kundenservice Trofaiach
> Luchinettigasse 6
> 8793 Trofaiach
> Telefon: +43 5 0766-157777
> E-Mail: trofaiach@oegk.at

> Mittwoch:08.00 – 12.00

### https://www.oegk.at/cdscontent/?contentid=10007.883182&portal=oegkportal

Records: `oegk-kundenservice-knittelfeld`.

> Kundenservice Knittelfeld
> Friedensstraße 1
> 8720 Knittelfeld
> Telefon: +43 5 0766-157777
> E-Mail: knittelfeld@oegk.at

> Montag:07.00 – 14.00
> Mittwoch:07.00 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883183&portal=oegkportal

Records: `oegk-kundenservice-leibnitz`.

> Kundenservice Leibnitz
> Augasse 21
> 8430 Leibnitz
> Telefon: +43 5 0766-157777
> E-Mail: leibnitz@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883184&portal=oegkportal

Records: `oegk-kundenservice-leoben`.

> Kundenservice Leoben
> Mühltaler Straße 22
> 8700 Leoben
> Telefon: +43 5 0766-157777
> E-Mail: leoben@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883185&portal=oegkportal

Records: `oegk-kundenservice-liezen`.

> Kundenservice Liezen
> Bahnhofweg 6
> 8940 Liezen
> Telefon: +43 5 0766-157777
> E-Mail: liezen@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883186&portal=oegkportal

Records: `oegk-kundenservice-mariazell`.

> Kundenservice Mariazell
> Hermann-Geist-Platz 1, Stadtamt, Stadtamt
> 8630 Mariazell
> Telefon: +43 5 0766-157777
> E-Mail: bruckmur@oegk.at

> Donnerstag:11.00 – 13.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883188&portal=oegkportal

Records: `oegk-kundenservice-murau`.

> Kundenservice Murau
> Bundesstraße 7
> 8850 Murau
> Telefon: +43 5 0766-157777
> E-Mail: murau@oegk.at

> Dienstag:07.00 – 14.00
> Donnerstag:07.00 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883192&portal=oegkportal

Records: `oegk-kundenservice-muerzzuschlag`.

> Kundenservice Mürzzuschlag
> Sparkassenplatz 3
> 8680 Mürzzuschlag
> Telefon: +43 5 0766-157777
> E-Mail: muerzzuschlag@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883193&portal=oegkportal

Records: `oegk-kundenservice-schladming`.

> Kundenservice Schladming
> Vorstadtgasse 119
> 8970 Schladming
> Telefon: +43 5 0766-157777
> E-Mail: schladming@oegk.at

> Montag:07.00 – 14.00
> Mittwoch:07.00 – 14.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883194&portal=oegkportal

Records: `oegk-kundenservice-voitsberg`.

> Kundenservice Voitsberg
> Conrad-von-Hötzendorf-Straße 48
> 8570 Voitsberg
> Telefon: +43 5 0766-157777
> E-Mail: voitsberg@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883195&portal=oegkportal

Records: `oegk-kundenservice-weiz`.

> Kundenservice Weiz
> Schubertgasse 2
> 8160 Weiz
> Telefon: +43 5 0766-157777
> E-Mail: weiz@oegk.at

> Montag:07.00 – 14.00
> Dienstag:07.00 – 14.00
> Mittwoch:07.00 – 14.00
> Donnerstag:07.00 – 14.00
> Freitag:07.00 – 13.30

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.883196&portal=oegkportal

Records: `oegk-kundenservice-graz`.

> Kundenservice Graz
> Josef-Pongratz-Platz 1
> 8010 Graz
> Telefon: +43 5 0766-153000
> E-Mail: graz@oegk.at

> Montag:07.00 – 16.00
> Dienstag:07.00 – 16.00
> Mittwoch:07.00 – 16.00
> Donnerstag:07.00 – 16.00
> Freitag:07.00 – 16.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.oegk.at/cdscontent/?contentid=10007.885963&portal=oegkportal

Records: `oegk-kundenservice-laakirchen`.

> Kundenservice Laakirchen
> Rathausplatz 1
> 4663 Laakirchen
> Telefon: +43 5 0766-14173970
> E-Mail: gmunden@oegk.at

> Donnerstag:08.00 – 11.00

> Unser Standort ist barrierefrei zugänglich.

### https://www.pv.at/web/service-und-kontakt/kontakt

Records: `pva-burgenland`, `pva-kaernten`, `pva-niederoesterreich`, `pva-oberoesterreich`, `pva-salzburg`, `pva-steiermark`, `pva-tirol`, `pva-vorarlberg`, `pva-wien`.

> Nach telefonischer Terminvereinbarung stehen die Mitarbeiter*innen in unseren Landesstellen für persönliche Vorsprachen gerne zur Verfügung.
> Auskunfts- und Beratungszeiten:
> Montag bis Mittwoch und Freitag von 7:00 bis 15:00 Uhr
> Donnerstag von 7:00 bis 18:00 Uhr

> Die Zuständigkeit der Landesstellen richtet sich ausschließlich nach dem Wohnort, bei Wohnsitz im Ausland ist die Landesstelle Wien zuständig.

### https://www.pv.at/web/service-und-kontakt/kontakt/burgenland/kontakt-burgenland

Records: `pva-burgenland`.

> Adresse: Ödenburger Straße 8,
> 7000 Eisenstadt
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-33 850
> E-Mail: pva-lsb@pv.at

### https://www.pv.at/web/service-und-kontakt/kontakt/kaernten/kontakt-kaernten

Records: `pva-kaernten`.

> Adresse: Südbahngürtel 10,
> 9020 Klagenfurt am Wörthersee
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-35 850
> E-Mail: pva-lsk@pv.at

### https://www.pv.at/web/service-und-kontakt/kontakt/niederoesterreich/kontakt-niederoesterreich

Records: `pva-niederoesterreich`.

> Adresse: Kremser Landstraße 5,
> 3100 St. Pölten
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-32 850
> E-Mail: pva-lsn@pv.at

### https://www.pv.at/web/service-und-kontakt/kontakt/oberoesterreich/kontakt-oberoesterreich

Records: `pva-oberoesterreich`.

> Adresse: Terminal Tower, Bahnhofplatz 8,
> 4020 Linz
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-36 850
> E-Mail: pva-lso@pv.at

### https://www.pv.at/web/service-und-kontakt/kontakt/salzburg/kontakt-salzburg

Records: `pva-salzburg`.

> Adresse: Schallmooser Hauptstraße 11,
> 5020 Salzburg
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-37 850
> E-Mail: pva-lss@pv.at

### https://www.pv.at/web/service-und-kontakt/kontakt/steiermark/kontakt-steiermark

Records: `pva-steiermark`.

> Adresse: Eggenberger Straße 3,
> 8020 Graz
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-34 850
> E-Mail: pva-lsg@pv.at

### https://www.pv.at/web/service-und-kontakt/kontakt/tirol/kontakt-tirol

Records: `pva-tirol`.

> Adresse: Ing.-Etzel-Straße 13,
> 6020 Innsbruck
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-38 850
> E-Mail: pva-lst@pv.at

### https://www.pv.at/web/service-und-kontakt/kontakt/vorarlberg/kontakt-vorarlberg

Records: `pva-vorarlberg`.

> Adresse: Zollgasse 6,
> 6850 Dornbirn
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-39 850
> E-Mail: pva-lsv@pv.at

### https://www.pv.at/web/service-und-kontakt/kontakt/wien/kontakt-wien

Records: `pva-wien`.

> Adresse: Friedrich-Hillegeist-Straße 1,
> 1020 Wien
> Telefon: +43 (0)5 03 03
> Fax: +43 (0)5 03 03-28 850
> E-Mail: pva-lsw@pv.at

> Wir sind umgezogen: Während der Generalsanierung der Pensionsversicherung (PV) in der Friedrich-Hillegeist-Straße befindet sich das Kund*innenzentrum in der Ghegastraße 1, 1030 Wien.

### https://www.sozialversicherung.gv.at/formgen/?contentid=10007.853637&portal=svsportal&LO=4&layout=withoutNav

Records: `svs-burgenland`, `svs-kaernten`, `svs-niederoesterreich`, `svs-oberoesterreich`, `svs-salzburg`, `svs-steiermark`, `svs-tirol`, `svs-vorarlberg`, `svs-wien`, `svs-hauptstelle`, `svs-servicestelle-baden`.

> Allgemeine Anfrage

### https://www.svs.at/cdscontent/?contentid=10007.816776&portal=svsportal

Records: discovery / source review only.

> Organisationsstruktur

### https://www.svs.at/cdscontent/?contentid=10007.816865&portal=svsportal

Records: `svs-hauptstelle`.

> Sozialversicherungsanstalt der Selbständigen
> Wiedner Hauptstraße 84-86
> 1051 Wien
> Tel.: 050 808 808

### https://www.svs.at/cdscontent/?contentid=10007.816867&portal=svsportal

Records: discovery / source review only.

> SVS-Kundencenter Wien

### https://www.svs.at/cdscontent/?contentid=10007.816868&portal=svsportal

Records: `svs-servicestelle-baden`.

> Servicestelle Baden
> Bahngasse 8
> 2500 Baden bei Wien
> Montag bis Donnerstag: 7.30 bis 14.30 Uhr
> Freitag: 7.30 bis 13.30 Uhr

> Telefonisch beantworten wir Ihre Fragen gerne unter: 050 808 808

### https://www.svs.at/cdscontent/?contentid=10007.816869&portal=svsportal

Records: discovery / source review only.

> SVS-Kundencenter Burgenland

### https://www.svs.at/cdscontent/?contentid=10007.816870&portal=svsportal

Records: discovery / source review only.

> SVS-Kundencenter Oberösterreich

### https://www.svs.at/cdscontent/?contentid=10007.816871&portal=svsportal

Records: discovery / source review only.

> SVS-Kundencenter Steiermark

### https://www.svs.at/cdscontent/?contentid=10007.816872&portal=svsportal

Records: discovery / source review only.

> SVS-Kundencenter Kärnten

### https://www.svs.at/cdscontent/?contentid=10007.816873&portal=svsportal

Records: discovery / source review only.

> SVS-Kundencenter Salzburg

### https://www.svs.at/cdscontent/?contentid=10007.816874&portal=svsportal

Records: discovery / source review only.

> SVS-Kundencenter Tirol

### https://www.svs.at/cdscontent/?contentid=10007.816875&portal=svsportal

Records: discovery / source review only.

> SVS-Kundencenter Vorarlberg

### https://www.svs.at/cdscontent/?contentid=10007.846416&portal=svsportal

Records: `svs-hauptstelle`.

> Hier gleich online Ihr Anliegen an die SVS senden

### https://www.svs.at/cdscontent/?contentid=10007.861000&portal=svsportal

Records: `svs-burgenland`, `svs-kaernten`, `svs-niederoesterreich`, `svs-oberoesterreich`, `svs-salzburg`, `svs-steiermark`, `svs-tirol`, `svs-vorarlberg`, `svs-wien`.

> Burgenland
> Adresse
> Siegfried Marcus-Straße 5
> 7000 Eisenstadt
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 - 16:00
> Di:
> 07:30 - 16:00
> Mi:
> 07:30 - 16:00
> Do:
> 07:30 - 16:00
> Fr:
> 07:30 - 14:30

> Kärnten
> Adresse
> Feldkirchner Straße 52
> 9020 Klagenfurt am Wörthersee
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 – 16:00 Uhr
> Di:
> 07:30 – 16:00 Uhr
> Mi:
> 07:30 – 16:00 Uhr
> Do:
> 07:30 – 16:00 Uhr
> Fr:
> 07:30 – 14:30 Uhr

> Niederösterreich
> Adresse
> Neugebäudeplatz 1
> 3100 St. Pölten
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 – 16:00 Uhr
> Di:
> 07:30 – 16:00 Uhr
> Mi:
> 07:30 – 16:00 Uhr
> Do:
> 07:30 – 16:00 Uhr
> Fr:
> 07:30 – 14:30 Uhr

> Oberösterreich
> Adresse
> Hanuschstraße 34
> 4020 Linz
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 - 16:00 Uhr
> Di:
> 07:30 - 16:00 Uhr
> Mi:
> 07:30 - 16:00 Uhr
> Do:
> 07:30 - 16:00 Uhr
> Fr:
> 07:30 - 14:30 Uhr

> Salzburg
> Adresse
> Auerspergstraße 24
> 5020 Salzburg
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 - 16:00 Uhr
> Di:
> 07:30 - 16:00 Uhr
> Mi:
> 07:30 - 16:00 Uhr
> Do:
> 07:30 - 16:00 Uhr
> Fr:
> 07:30 - 14:30 Uhr

> Steiermark
> Adresse
> Körblergasse 115
> 8010 Graz
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 - 16:00
> Di:
> 07:30 - 16:00
> Mi:
> 07:30 - 16:00
> Do:
> 07:30 - 16:00
> Fr:
> 07:30 - 14:30

> Tirol
> Adresse
> Klara-Pölt-Weg 1
> 6020 Innsbruck
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 - 16:00
> Di:
> 07:30 - 16:00
> Mi:
> 07:30 - 16:00
> Do:
> 07:30 - 16:00
> Fr:
> 07:30 - 14:30

> Vorarlberg
> Adresse
> Schloßgraben 14
> 6800 Feldkirch
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 – 16:00 Uhr
> Di:
> 07:30 – 16:00 Uhr
> Mi:
> 07:30 – 16:00 Uhr
> Do:
> 07:30 – 16:00 Uhr
> Fr:
> 07:30 – 14:30 Uhr

> Wien
> Kundencenter-Adresse
> Wiedner Hauptstraße 84-86
> 1051 Wien
> Vorsprache
> ausschließlich mit Terminvereinbarung
> Telefonische Erreichbarkeit
> Tel: 050 808 808
> Mo:
> 07:30 - 16:00
> Di:
> 07:30 - 16:00
> Mi:
> 07:30 - 16:00
> Do:
> 07:30 - 16:00
> Fr:
> 07:30 - 14:30
