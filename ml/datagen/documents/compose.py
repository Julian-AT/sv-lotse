# ruff: noqa: E501
"""Spec + model sections -> laid-out document with gold tags (one composer per document type)."""

from __future__ import annotations

import random
from typing import Any

from reportlab.pdfbase.pdfmetrics import stringWidth

from .content import Section
from .layout import FONTS, MM, PAGE_W, Engine, Fields, Layout, Para, Rule, Run, Space, Table, Tag
from .names import FEMALE_FIRST
from .spec import DocSpec

FOOTER_FICTIONAL = "Synthetisches Musterdokument (AT-Benefits) - fiktive Personen und Einrichtungen"
FOOTER_OFFICE = (
    "Synthetisches Musterdokument (AT-Benefits) - nicht von der genannten Stelle erstellt"
)

REC = "documented_recommendation"
ADM = "administrative_fact"

# fact types whose values are searched inside model-written sentences
INLINE_FACTS = {
    "care_level",
    "amount",
    "appointment_date",
    "deadline",
    "discharge_date",
    "admission_date",
}


class Composer:
    def __init__(self, spec: DocSpec, sections: list[Section]):
        self.spec = spec
        self.sections = {s.key: s for s in sections}
        self.rng = random.Random(int(spec.doc_id.split("-")[-1], 16) ^ spec.seed)
        lay = spec.layout
        footer = [FOOTER_FICTIONAL if spec.issuer.fictional else FOOTER_OFFICE]
        running = None
        if spec.doc_type == "discharge_letter":
            running = f"Entlassungsbrief {spec.patient.full}, geb. {spec.patient.birth_date}"
        self.e = Engine(
            Layout(
                font=lay.get("font", "Helvetica"),
                size=float(lay.get("size", 10.0)),
                margin=float(lay.get("margin_mm", 20)) * MM,
                footer=footer,
                running_header=running,
            )
        )
        self.n = 0

    # --- tags -------------------------------------------------------------------------------
    def tag(self, type_: str, fact_type: str, **extra: Any) -> Tag:
        self.n += 1
        return Tag(
            f"s{self.n:03d}", {"kind": "statement", "type": type_, "fact_type": fact_type, **extra}
        )

    def exclusion(self, reason: str = "clinical_content") -> Tag:
        self.n += 1
        return Tag(f"x{self.n:03d}", {"kind": "exclusion", "reason": reason})

    def sentence_run(self, s, section_key: str) -> Run:
        run = Run(s.text)
        if s.role == "recommendation":
            rec = next(r for r in self.spec.recommendations if r["id"] == s.rec)
            run.tags.append(
                (
                    0,
                    len(s.text),
                    self.tag(
                        REC,
                        "documented_recommendation",
                        recommendation=rec["kind"],
                        benefit=rec["benefit"],
                        source="model",
                    ),
                )
            )
            return run
        if s.role == "clinical":
            run.tags.append((0, len(s.text), self.exclusion()))
            return run
        if s.role == "open_task":
            run.tags.append((0, len(s.text), self.tag(ADM, "open_task", source="model")))
        elif section_key == "ruling":
            run.tags.append(
                (
                    0,
                    len(s.text),
                    self.tag(ADM, "decision", outcome=self.spec.outcome, source="model"),
                )
            )
        for f in self.spec.facts:
            if (
                (
                    f["type"] in INLINE_FACTS
                    or (
                        f["type"] == "institution"
                        and section_key == "ruling"
                        and f["label"] == "Einrichtung"
                    )
                )
                and f["value"] in s.text
                and not any(
                    t.data.get("fact_type") == f["type"] and a <= s.text.find(f["value"]) < b
                    for a, b, t in run.tags
                )
            ):
                run.tag_sub(f["value"], self.tag(ADM, f["type"], source="spec"))
        return run

    def section(self, key: str, heading_style: str = "heading") -> None:
        sec = self.sections.get(key)
        if sec is None:
            return
        if sec.heading:
            self.e.ensure(self.e.l.size * 6)  # keep the heading with its first lines
            self.e.add(
                Para([Run(sec.heading)], style=heading_style, space_before=self.e.l.size * 0.7)
            )
        if sec.style == "bullets":
            for s in sec.sentences:
                self.e.add(Para([self.sentence_run(s, key)], bullet="-", indent=4, space_before=1))
        else:
            # one paragraph per section, or split long sections into 2-3 paragraphs
            runs = [self.sentence_run(s, key) for s in sec.sentences]
            chunk = 4 if len(runs) > 5 else len(runs)
            for i in range(0, len(runs), max(chunk, 1)):
                self.e.add(Para(runs[i : i + chunk], space_before=self.e.l.size * 0.35))

    # --- letter parts -------------------------------------------------------------------------
    def letterhead(self) -> None:
        sp, e = self.spec, self.e
        align = sp.layout.get("letterhead", "left")
        e.add(
            Para(
                [
                    Run.whole(
                        sp.issuer.name, self.tag(ADM, "institution", role="issuer", source="spec")
                    )
                ],
                style="letterhead",
                align=align,
            )
        )
        lines = list(sp.issuer.lines)
        contact = []
        if sp.issuer.phone:
            contact.append(f"Tel. {sp.issuer.phone}")
        if sp.issuer.email:
            contact.append(sp.issuer.email)
        if contact:
            lines.append(" | ".join(contact))
        for i, line in enumerate(lines):
            tag = None
            if i == 0 and sp.doc_type == "discharge_letter":
                tag = self.tag(ADM, "institution", role="department", source="spec")
            e.add(Para([Run.whole(line, tag)], style="small", align=align))
        if sp.layout.get("rule", True):
            e.add(Rule(space_before=4))
        else:
            e.add(Space(8))

    def address_and_info(self, info: list[tuple[str, Run]]) -> None:
        sp, e = self.spec, self.e
        sender = " - ".join([sp.issuer.name, *sp.issuer.lines[-2:]])[:110]
        e.add(Space(10))
        top = e.y
        e.add(Para([Run(sender)], style="tiny", width=85 * MM))
        p = sp.recipient
        addr = [p.anrede, f"{p.first} {p.last}", p.street, f"{p.postal_code} {p.locality}"]
        for line in [a for a in addr if a]:
            e.add(Para([Run(line)], width=85 * MM))
        bottom = e.y
        if sp.layout.get("info_block") == "right":
            e.y = top
            font, size = e.font_for("small")
            bold = FONTS[e.l.font][1]
            need = (
                max(stringWidth(lab, bold, size) for lab, _ in info)
                + 6
                + max(stringWidth(r.text, font, size) for _, r in info)
                + 4
            )
            width = min(max(72 * MM, need), PAGE_W - 2 * e.l.margin - 60 * MM)
            x = PAGE_W - e.l.margin - width
            e.add(Fields(info, label_width=24 * MM, x=x, width=width, style="small"))
            e.y = min(e.y, bottom) - 14
        else:
            e.y = bottom - 10
            e.add(Fields(info, label_width=38 * MM, style="small"))
            e.y -= 8

    def info_rows(self, extra: list[tuple[str, str, str]] = ()) -> list[tuple[str, Run]]:
        rows: list[tuple[str, Run]] = []
        sp = self.spec
        for label, ftype in [(sp.reference_label, "case_number")]:
            rows.append(
                (label, Run.whole(sp.reference, self.tag(ADM, ftype, label=label, source="spec")))
            )
        date_label = "Rechnungsdatum" if sp.doc_type == "wahlarzt_invoice" else "Datum"
        rows.append(
            (date_label, Run.whole(sp.letter_date, self.tag(ADM, "document_date", source="spec")))
        )
        for label, value, ftype in extra:
            rows.append(
                (
                    label,
                    Run.whole(
                        value, self.tag(ADM, ftype, label=label, source="spec") if ftype else None
                    ),
                )
            )
        if sp.issuer.signatory and sp.issuer.kind not in {"hospital", "practice"}:
            rows.append(("Sachbearbeitung", Run(sp.issuer.signatory)))
        return rows

    def signature(self, closing: str = "Mit freundlichen Grüßen", role: str | None = None) -> None:
        sp, e = self.spec, self.e
        e.add(Para([Run(closing)], space_before=e.l.size * 1.2))
        if sp.issuer.kind not in {"hospital", "practice"}:
            e.add(
                Para(
                    [
                        Run(
                            self.rng.choice(
                                [
                                    "Im Auftrag",
                                    "Für die Behörde:",
                                    "Mit freundlichen Grüßen aus der Fachabteilung",
                                ]
                            )
                            if closing != "Mit freundlichen Grüßen"
                            else "Im Auftrag"
                        )
                    ],
                    space_before=2,
                )
            )
        e.add(Space(e.l.size * 2.2))
        e.add(Para([Run(sp.issuer.signatory)]))
        if role:
            e.add(Para([Run(role)], style="small"))

    # --- document types ------------------------------------------------------------------------
    def discharge_letter(self) -> None:
        sp, e = self.spec, self.e
        self.letterhead()
        info = self.info_rows()
        self.address_and_info(info)
        e.add(Para([Run("Entlassungsbrief")], style="title", space_before=4))
        rows = [
            ("Patient/in", Run(f"{sp.patient.full}, geb. {sp.patient.birth_date}")),
            (
                "SV-Nummer",
                Run.whole(
                    sp.patient.insurance_number, self.tag(ADM, "insurance_number", source="spec")
                ),
            ),
        ]
        if sp.carrier_name:
            cv = sp.facts_value("carrier") or ""
            run = Run(f"{sp.carrier_name} ({cv})" if cv else sp.carrier_name)
            run.tag_sub(
                sp.carrier_name, self.tag(ADM, "carrier", source="spec", carrier=sp.carrier)
            )
            rows.append(("Versicherung", run))
        stay = Run(f"{sp.admission_date} bis {sp.discharge_date}")
        stay.tags.append(
            (0, len(sp.admission_date), self.tag(ADM, "admission_date", source="spec"))
        )
        stay.tags.append(
            (
                len(stay.text) - len(sp.discharge_date),
                len(stay.text),
                self.tag(ADM, "discharge_date", source="spec"),
            )
        )
        rows.append(("Stationär", stay))
        if sp.care_level:
            rows.append(
                (
                    "Pflegegeld",
                    Run.whole(f"Stufe {sp.care_level}", self.tag(ADM, "care_level", source="spec")),
                )
            )
        e.add(Fields(rows, label_width=32 * MM, space_before=4))
        salutation = self.rng.choice(
            [
                "Sehr geehrte Frau Kollegin, sehr geehrter Herr Kollege,",
                "Sehr geehrte Kolleginnen und Kollegen,",
                "Liebe Kollegin, lieber Kollege,",
            ]
        )
        e.add(Para([Run(salutation)], space_before=8))
        e.add(
            Para(
                [
                    Run(
                        f"wir berichten über {('Ihre Patientin' if sp.patient.sex == 'f' else 'Ihren Patienten')}, {('die' if sp.patient.sex == 'f' else 'der')} sich in unserer stationären Behandlung befand."
                    )
                ]
            )
        )
        for key in ("diagnoses", "reason", "course", "status", "social"):
            self.section(key)
        # medication
        e.ensure(e.l.size * 1.4 * (len(sp.medicines) + 3))
        e.add(
            Para([Run("Medikation bei Entlassung")], style="heading", space_before=e.l.size * 0.7)
        )
        rows_t = []
        for m in sp.medicines:
            rows_t.append(
                [
                    Run.whole(m["name"], self.tag(ADM, "named_medicine", source="spec")),
                    Run(m["strength"]),
                    Run(m["schema"]),
                ]
            )
        e.add(
            Table(["Wirkstoff", "Stärke", "Einnahme"], rows_t, [0.42, 0.22, 0.36], space_before=2)
        )
        self.section("recommendations")
        fu = sp.follow_up or {}
        if fu:
            value = f"{fu['date']}, {fu['time']}, {fu['place']}"
            run = Run(f"Kontrolltermin: {value}")
            run.tags.append(
                (len("Kontrolltermin: "), len(run.text), self.tag(ADM, "follow_up", source="spec"))
            )
            run.tags.append(
                (
                    len("Kontrolltermin: "),
                    len("Kontrolltermin: ") + len(fu["date"]),
                    self.tag(ADM, "visit_date", source="spec"),
                )
            )
            e.add(Para([run], space_before=e.l.size * 0.5))
        female = any(f" {n} " in f" {sp.issuer.signatory} " for n in FEMALE_FIRST)
        pairs = [
            ("Oberärztin", "Oberarzt"),
            ("Stationsärztin", "Stationsarzt"),
            ("Primaria", "Primarius"),
            ("Assistenzärztin", "Assistenzarzt"),
        ]
        role = self.rng.choice(pairs)[0 if female else 1]
        self.signature(closing="Mit kollegialen Grüßen", role=role)

    def decision(self) -> None:
        sp, e = self.spec, self.e
        self.letterhead()
        extra = (
            [("Versicherungsnummer", sp.patient.insurance_number, "insurance_number")]
            if sp.facts_value("insurance_number")
            else []
        )
        self.address_and_info(self.info_rows(extra))
        e.add(Para([Run("BESCHEID" if self.rng.random() < 0.6 else "Bescheid")], style="title"))
        e.add(Para([Run(f"über Ihren Antrag auf {sp.benefit_name}")], style="bold", space_before=2))
        self.section("ruling")
        self.section("reasons")
        self.section("notes")
        ap = sp.appeal or {}
        e.add(
            Para(
                [
                    Run(
                        "Rechtsmittelbelehrung"
                        if sp.register == "standard"
                        else "Wenn Sie nicht einverstanden sind"
                    )
                ],
                style="heading",
                space_before=e.l.size,
            )
        )
        if sp.register == "plain":
            text = f"Sie können sich gegen diese Entscheidung wehren. Dafür haben Sie {ap['period_nom']} Zeit. Die Frist beginnt mit dem Tag, an dem Sie diesen Brief bekommen haben."
            how = f"Sie können {ap['plain']}."
            runs = [Run(text), Run(how)]
            runs[0].tag_sub(
                ap["period_nom"],
                self.tag(ADM, "deadline", relative=True, days=ap["days"], source="spec"),
            )
            runs[1].tags.append(
                (0, len(how), self.tag(ADM, "appeal_info", route=ap["route"], source="spec"))
            )
        else:
            text = f"Sie haben das Recht, gegen diesen Bescheid binnen {ap['period']} nach seiner {ap['from']} {ap['body']}."
            runs = [Run(text)]
            runs[0].tags.append(
                (0, len(text), self.tag(ADM, "appeal_info", route=ap["route"], source="spec"))
            )
            runs[0].tag_sub(
                f"binnen {ap['period']}",
                self.tag(ADM, "deadline", relative=True, days=ap["days"], source="spec"),
            )
        e.add(Para(runs, space_before=2))
        e.add(
            Para(
                [
                    Run(
                        f"Die {ap['noun']} muss den Bescheid bezeichnen, ein bestimmtes Begehren enthalten und begründet sein."
                        if ap["noun"] == "Klage"
                        else f"Die {ap['noun']} hat den Bescheid zu bezeichnen und die Gründe sowie das Begehren zu enthalten."
                    )
                ],
                space_before=2,
            )
        )
        self.signature()

    def request(self) -> None:
        sp, e = self.spec, self.e
        self.letterhead()
        extra = (
            [("Versicherungsnummer", sp.patient.insurance_number, "insurance_number")]
            if sp.facts_value("insurance_number")
            else []
        )
        self.address_and_info(self.info_rows(extra))
        if sp.doc_type == "reminder":
            subject = self.rng.choice(
                [
                    "Erinnerung: fehlende Unterlagen",
                    "Erinnerung an unser Schreiben",
                    "2. Aufforderung zur Vorlage von Unterlagen",
                ]
            )
        else:
            subject = self.rng.choice(
                [
                    "Aufforderung zur Vorlage von Unterlagen",
                    "Ihr Antrag - fehlende Unterlagen",
                    "Ersuchen um Nachreichung von Unterlagen",
                ]
            )
        e.add(Para([Run(subject)], style="title"))
        e.add(Para([Run(f"Ihr Antrag auf {sp.benefit_name}")], style="bold", space_before=2))
        e.add(Para([Run(sp.patient.salutation + ",")], space_before=8))
        self.section("intro")
        self.section("explanation")
        lead = (
            "Bitte schicken Sie uns:"
            if sp.register == "plain"
            else self.rng.choice(
                [
                    "Bitte legen Sie folgende Unterlagen vor:",
                    "Wir ersuchen Sie, folgende Unterlagen nachzureichen:",
                    "Folgende Unterlagen fehlen noch:",
                ]
            )
        )
        e.add(Para([Run(lead)], space_before=e.l.size * 0.5))
        for d in sp.requested_documents:
            e.add(
                Para(
                    [
                        Run.whole(
                            d["name"],
                            self.tag(
                                ADM,
                                "requested_document",
                                catalog_document=d["id"],
                                source="catalog",
                            ),
                        )
                    ],
                    bullet="-",
                    indent=6,
                    space_before=1,
                )
            )
        dl = sp.deadline["date"]
        if sp.register == "plain":
            text = f"Bitte schicken Sie uns die Unterlagen bis {dl}."
        else:
            text = self.rng.choice(
                [
                    f"Bitte übermitteln Sie die Unterlagen bis spätestens {dl}.",
                    f"Wir ersuchen um Vorlage bis {dl}.",
                    f"Die Unterlagen müssen bis {dl} bei uns einlangen.",
                ]
            )
        run = Run(text)
        run.tags.append((0, len(text), self.tag(ADM, "open_task", source="spec")))
        run.tag_sub(
            dl, self.tag(ADM, "deadline", relative=False, date=sp.deadline["iso"], source="spec")
        )
        if sp.register == "plain":
            consequence = "Wenn die Unterlagen fehlen, können wir über Ihren Antrag nur mit den Unterlagen entscheiden, die wir schon haben."
        else:
            consequence = self.rng.choice(
                [
                    "Langen die Unterlagen nicht fristgerecht ein, muss über Ihren Antrag auf Grundlage der vorliegenden Unterlagen entschieden werden.",
                    "Werden die Unterlagen nicht fristgerecht vorgelegt, kann Ihr Antrag nur nach der vorliegenden Aktenlage beurteilt werden.",
                ]
            )
        crun = Run.whole(consequence, self.tag(ADM, "next_step", source="spec"))
        e.add(Para([run, crun], space_before=e.l.size * 0.5))
        self.section("closing")
        self.signature()

    def invoice(self) -> None:
        sp, e = self.spec, self.e
        self.letterhead()
        extra = [("Versicherungsnummer", sp.patient.insurance_number, "insurance_number")]
        if sp.carrier_name:
            extra.append(("Versicherung", sp.facts_value("carrier") or sp.carrier_name, "carrier"))
        self.address_and_info(self.info_rows(extra))
        e.add(Para([Run("Honorarnote")], style="title"))
        e.add(
            Para(
                [Run(f"Patient/in: {sp.patient.full}, geb. {sp.patient.birth_date}")],
                space_before=4,
            )
        )
        self.section("diagnosis")
        rows = []
        for it in sp.invoice_items:
            rows.append(
                [
                    Run.whole(it["date"], self.tag(ADM, "visit_date", source="spec")),
                    Run(it["service"]),
                    Run(it["amount"]),
                ]
            )
        total = sp.facts_value("amount") or ""
        rows.append(
            [Run(""), Run("Gesamtbetrag"), Run.whole(total, self.tag(ADM, "amount", source="spec"))]
        )
        e.add(Table(["Datum", "Leistung", "Betrag"], rows, [0.2, 0.55, 0.25], align_right=(2,)))
        if sp.layout.get("paid", True):
            run = Run(
                self.rng.choice(
                    [
                        f"Betrag dankend erhalten am {sp.letter_date}.",
                        f"Bezahlt mit Bankomatkarte am {sp.letter_date}.",
                        f"Betrag bar erhalten am {sp.letter_date}.",
                    ]
                )
            )
            run.tag_sub(sp.letter_date, self.tag(ADM, "payment_date", source="spec"))
            e.add(Para([run], space_before=6))
        else:
            iban = "AT00 " + " ".join(f"{self.rng.randint(0, 9999):04d}" for _ in range(4))
            e.add(
                Para(
                    [Run(f"Zahlbar binnen 14 Tagen ohne Abzug auf das Konto {iban} (fiktiv).")],
                    space_before=6,
                )
            )
        self.section("note")
        e.add(
            Para(
                [Run("Umsatzsteuerfrei gemäß § 6 Abs. 1 Z 19 UStG.")], style="small", space_before=6
            )
        )
        self.signature(closing="Mit freundlichen Grüßen")

    def prescription(self) -> None:
        sp, e = self.spec, self.e
        carrier = sp.carrier_name or "Krankenversicherungsträger"
        cv = sp.facts_value("carrier")
        head = Run(f"{carrier} ({cv})" if cv else carrier)
        if sp.carrier_name:
            head.tag_sub(
                sp.carrier_name, self.tag(ADM, "carrier", carrier=sp.carrier, source="spec")
            )
        e.add(
            Para(
                [Run("Rezept" if sp.prescription_kind == "medicine" else "Ärztliche Verordnung")],
                style="title",
            )
        )
        e.add(Para([head], style="bold", space_before=4))
        rows = [
            ("Name", Run(f"{sp.patient.first} {sp.patient.last}")),
            ("Geburtsdatum", Run(sp.patient.birth_date)),
            (
                "VSNR",
                Run.whole(
                    sp.patient.insurance_number, self.tag(ADM, "insurance_number", source="spec")
                ),
            ),
            (
                "Anschrift",
                Run(f"{sp.patient.street}, {sp.patient.postal_code} {sp.patient.locality}"),
            ),
            (
                sp.reference_label,
                Run.whole(sp.reference, self.tag(ADM, "case_number", source="spec")),
            ),
        ]
        e.add(Fields(rows, label_width=32 * MM, space_before=4))
        e.add(Rule(space_before=4))
        e.add(Para([Run("Rp.")], style="bold", space_before=4))
        for m in sp.medicines:
            if sp.prescription_kind == "medicine":
                text = f"{m['name']} {m['strength']} {self.rng.choice(['Filmtabletten', 'Tabletten', 'Kapseln'])} {self.rng.choice(['OP I', 'OP II', 'OP III'])}"
            else:
                text = f"{m['name']}, {m['strength']}"
            run = Run(text)
            run.tag_sub(
                m["name"],
                self.tag(
                    ADM,
                    "named_medicine" if sp.prescription_kind == "medicine" else "prescribed_item",
                    source="spec",
                ),
            )
            e.add(Para([run], indent=8, space_before=3))
            e.add(
                Para(
                    [
                        Run(
                            f"S: {m['schema']}"
                            if sp.prescription_kind == "medicine"
                            else "Verordnung laut Befund"
                        )
                    ],
                    style="small",
                    indent=16,
                )
            )
        e.add(Rule(space_before=10))
        e.add(
            Para(
                [
                    Run.whole(
                        sp.issuer.name,
                        self.tag(ADM, "institution", role="prescriber", source="spec"),
                    )
                ],
                style="bold",
                space_before=4,
            )
        )
        for line in sp.issuer.lines:
            e.add(Para([Run(line)], style="small"))
        run = Run(f"Ausgestellt am {sp.letter_date}")
        run.tag_sub(sp.letter_date, self.tag(ADM, "document_date", source="spec"))
        e.add(Para([run], space_before=4))
        e.add(Para([Run("(Stampiglie und Unterschrift)")], style="small", space_before=14))

    def build(self) -> Engine:
        {
            "discharge_letter": self.discharge_letter,
            "decision": self.decision,
            "document_request": self.request,
            "reminder": self.request,
            "wahlarzt_invoice": self.invoice,
            "prescription": self.prescription,
        }[self.spec.doc_type]()
        self.e.finish()
        return self.e
