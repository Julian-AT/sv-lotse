# Prevention and family bundle additions (FR-G5, FR-G6)

Sources retrieved 2026-11-06. Records remain **awaiting human review**; no top-level
`verified_at` is invented. The schema and reference loader validates all records.

- Vorsorgeuntersuchung: [programme access](https://www.gesundheit.gv.at/leben/gesundheitsvorsorge/vorsorgeuntersuchung.html)
  and [published rationale and access without insurance](https://www.gesundheit.gv.at/leben/gesundheitsvorsorge/vorsorgeuntersuchung/was-wird-gemacht.html).
- Breast screening: [automatic access and opt-in age groups](https://www.frueh-erkennen.at/so-koennen-sie-teilnehmen/),
  [programme rationale](https://www.gesundheit.gv.at/krankheiten/krebs/brustkrebs/frueherkennung.html)
  and [family-history referral](https://www.frueh-erkennen.at/faqs/).
  Automatic access and the two voluntary age groups are separate records so the
  existing target-group schema represents them without changing a contract.
- Colorectal screening: [age, intervals and programme rationale](https://www.gesundheit.gv.at/krankheiten/krebs/darmkrebs/frueherkennung-diagnose.html).
- Bewegt im Park: [programme](https://www.bewegt-im-park.at/),
  [season](https://www.bmwkms.gv.at/themen/sport/breitensport/breiten-gesundheitssport/bewegungsangebote/bewegt-im-park.html)
  and [published access rationale](https://www.gesundheit.gv.at/news/aktuelles/aktuell-2026/bewegt-im-park.html).
- Vaccinations: [public influenza programme](https://impfen.gv.at/impfungen/influenza),
  [access from age 60](https://www.gesundheitskasse.at/cdscontent/load?contentid=10008.798702&version=1759924855),
  [children's programme](https://www.sozialministerium.gv.at/Themen/Gesundheit/Impfen/Kostenfreies-Kinderimpfprogramm.html),
  [children's programme rationale](https://www.gesundheit.gv.at/linkresolution/link/65399)
  and [eImpfpass access](https://www.gesundheit.gv.at/gesundheitsleistungen/elga/elektronischer-impfpass.html).
- Nutrition: [access and costs](https://pflege.gv.at/de/diaetologie).
- Family counseling: [official directory and free counseling](https://www.familienberatung.gv.at/faq.html).

Process slots declare which offers include documented vaccination records.
The brain shows only confirmed, sourced entries; it never derives protection,
missing doses, a personal vaccine choice or a personal schedule from them.
Family-history criteria match only exact confirmed published criterion text;
individual screening decisions and an earlier start remain with the doctor.

Regional providers, programme capacity and appointments require a separate lookup.
The office reference identifies the real public health portal's information
**directory**, with no invented address, provider, availability or booking channel.
Known programme phone channels are recorded separately on the relevant benefits.
