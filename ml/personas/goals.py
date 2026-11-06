# ruff: noqa: E501 (natural-language templates)
"""Persona archetypes: one entry per goal.

Each goal fixes how a household is sampled and how the situation is told. Texts describe the life
situation only; they never name a catalog benefit (checked at render time against the gold names).
Placeholders: {rel}/{rel_acc} relative (German nominative/accusative), {pron}/{Pron} pronoun,
{poss} possessive (English). "self" texts are first person, "other" texts are told by a helper,
"parent" texts are first person about a child.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Goal:
    id: str
    area: str
    persp: tuple[str, ...]
    age: tuple[int, int]
    statuses: tuple[str, ...]
    sexes: tuple[str, ...] = ("f", "m")
    needs: bool = False
    children: tuple[int, int, int, int] | None = None  # min n, max n, min age, max age
    docs: tuple[str, ...] = ("e_card",)
    income: tuple[str, ...] = ("lt_1300", "1300_2000", "2000_3000", "gt_3000")
    weight: float = 1.0
    text: dict[str, dict[str, tuple[str, ...]]] = field(default_factory=dict)


WORKING = ("employed", "employed", "self_employed", "civil_servant", "marginal", "farmer")
RETIRED = ("pensioner", "pensioner", "pensioner", "pensioner_svs", "pensioner_bvaeb")
ANY_ADULT = WORKING + RETIRED + ("unemployed", "co_insured", "student")
LOW = ("lt_1300", "lt_1300", "1300_2000")

GOALS: tuple[Goal, ...] = (
    # ---- Area A: prevention ----
    Goal(
        "get_health_checkup",
        "A",
        ("self",),
        (18, 80),
        ANY_ADULT,
        docs=("e_card",),
        text={
            "de": {
                "self": (
                    "Ich war seit Jahren bei keinem Arzt und würde mich gern einmal komplett durchchecken lassen. Zahlt das die Kasse?",
                    "Ich möchte einfach wissen, ob bei mir alles passt, also so einen allgemeinen Gesundheitscheck machen.",
                    "Mein Hausarzt hat gemeint, ich sollte mal wieder einen Check machen. Wie geht das und wo?",
                )
            },
            "en": {
                "self": (
                    "I haven't seen a doctor in years and would like a general health check. Is that covered?",
                    "I just want to know that everything is fine with me, a full check-up of some kind.",
                )
            },
            "tr": {
                "self": (
                    "Yıllardır doktora gitmedim, genel bir sağlık kontrolü yaptırmak istiyorum. Sigorta bunu karşılıyor mu?",
                    "Her şey yolunda mı diye bir kontrolden geçmek istiyorum. Nereye başvurmam lazım?",
                )
            },
        },
    ),
    Goal(
        "cancer_screening",
        "A",
        ("self",),
        (40, 80),
        ANY_ADULT,
        sexes=("f", "f", "m"),
        text={
            "de": {
                "self": (
                    "In meiner Familie hatten mehrere Krebs. Ich will mich früh untersuchen lassen, bevor was ist.",
                    "Ich hab gehört, man kann ab einem gewissen Alter zur Mammografie oder Darmspiegelung gehen. Brauch ich da eine Überweisung?",
                )
            },
            "en": {
                "self": (
                    "Cancer runs in my family and I'd like to be screened early. What am I entitled to?",
                    "I heard there are free screenings like a mammogram or colonoscopy at my age. Do I need a referral?",
                )
            },
            "tr": {
                "self": (
                    "Ailemde kanser olanlar var. Erken teşhis için muayene olmak istiyorum, ne yapmam gerekiyor?",
                    "Benim yaşımda mamografi ya da bağırsak taraması ücretsiz mi? Sevk lazım mı?",
                )
            },
        },
    ),
    Goal(
        "adult_vaccination",
        "A",
        ("self", "other"),
        (60, 92),
        RETIRED + ("employed",),
        text={
            "de": {
                "self": (
                    "Ich bin jetzt über 60 und hab gehört, es gibt Impfungen gegen Lungenentzündung und Gürtelrose. Was kostet das?",
                    "Ich will mich gegen die Grippe impfen lassen. Wo geht das bei uns und muss ich zahlen?",
                ),
                "other": (
                    "Es geht um {rel_acc}. {Pron} sollte gegen Grippe und Gürtelrose geimpft werden, aber wir wissen nicht, wo und ob das was kostet.",
                ),
            },
            "en": {
                "self": (
                    "I'm over 60 and want the flu and shingles shots. Where can I get them and do I have to pay?",
                ),
                "other": (
                    "This is about {rel}. {Pron} should get the flu and pneumonia vaccines, but we don't know where or what it costs.",
                ),
            },
            "tr": {
                "self": (
                    "60 yaşını geçtim, grip ve zona aşısı olmak istiyorum. Nerede yapılıyor, ücretli mi?",
                ),
                "other": (
                    "{rel} için soruyorum. Grip ve zatürre aşısı olması lazım ama nerede ve ücretli mi bilmiyoruz.",
                ),
            },
        },
    ),
    Goal(
        "child_vaccination",
        "A",
        ("parent",),
        (22, 45),
        WORKING + ("parental_leave", "co_insured"),
        children=(1, 3, 0, 14),
        docs=("e_card", "birth_certificate"),
        text={
            "de": {
                "parent": (
                    "Mein Kind braucht die nächsten Impfungen. Muss ich die selber zahlen oder gibt es das gratis?",
                    "Der Kinderarzt hat gesagt, wir sind mit den Impfungen hinten. Wo kann ich das machen lassen?",
                )
            },
            "en": {
                "parent": (
                    "My child is due for vaccinations. Are they free or do I have to pay for them?",
                )
            },
            "tr": {
                "parent": ("Çocuğumun aşıları yaklaştı. Ücretsiz mi, yoksa biz mi ödeyeceğiz?",)
            },
        },
    ),
    Goal(
        "pregnancy_checks",
        "A",
        ("self",),
        (19, 43),
        WORKING + ("co_insured", "student", "unemployed"),
        sexes=("f",),
        docs=("e_card", "findings"),
        text={
            "de": {
                "self": (
                    "Ich bin schwanger, in der zehnten Woche. Welche Untersuchungen stehen mir zu und wo bekomme ich die Unterlagen dafür?",
                    "Wir bekommen ein Baby. Ich weiß nicht, welche Termine beim Frauenarzt ich jetzt machen muss.",
                )
            },
            "en": {
                "self": (
                    "I'm pregnant, about ten weeks. Which check-ups am I entitled to and where do I get the paperwork?",
                )
            },
            "tr": {
                "self": (
                    "Hamileyim, onuncu haftadayım. Hangi muayeneler hakkım ve belgeleri nereden alırım?",
                )
            },
        },
    ),
    # ---- Area B: health promotion ----
    Goal(
        "healthy_lifestyle",
        "B",
        ("self",),
        (18, 75),
        ANY_ADULT,
        weight=0.6,
        text={
            "de": {
                "self": (
                    "Der Arzt sagt, ich soll abnehmen und mich mehr bewegen. Gibt es da Kurse oder eine Beratung, die nichts kostet?",
                    "Ich hab Zucker im Anfangsstadium und will meine Ernährung umstellen. Wer hilft mir dabei?",
                )
            },
            "en": {
                "self": (
                    "My doctor says I need to lose weight and move more. Are there free classes or advice on eating better?",
                )
            },
            "tr": {
                "self": (
                    "Doktor kilo vermem ve daha çok hareket etmem gerektiğini söyledi. Ücretsiz kurs ya da beslenme danışmanlığı var mı?",
                )
            },
        },
    ),
    # ---- Area C: health insurance services ----
    Goal(
        "rehab_after_hospital",
        "C",
        ("self", "other"),
        (35, 88),
        ANY_ADULT,
        needs=True,
        docs=("e_card", "discharge_letter", "findings"),
        weight=1.4,
        text={
            "de": {
                "self": (
                    "Ich bin nach einer Hüftoperation aus dem Spital gekommen und komme noch nicht richtig auf die Beine. Kann ich irgendwo zur Kur?",
                    "Nach dem Herzinfarkt hat man mir gesagt, ich soll mich danach erholen, irgendwo stationär. Wie beantrage ich das?",
                ),
                "other": (
                    "Es geht um {rel_acc}. {Pron} war drei Wochen im Krankenhaus und ist jetzt sehr schwach. Wir hätten gern, dass {pron} danach irgendwo wieder fit wird.",
                    "Es geht um {rel_acc}. {Pron} hatte einen Schlaganfall und kommt bald aus dem Spital. Was passiert danach?",
                ),
            },
            "en": {
                "self": (
                    "I just got out of hospital after hip surgery and I'm still not steady on my feet. Can I go somewhere to recover?",
                ),
                "other": (
                    "This is about {rel}. {Pron} had a stroke and will be discharged soon. What happens after the hospital?",
                ),
            },
            "tr": {
                "self": (
                    "Kalça ameliyatından sonra hastaneden çıktım ama hâlâ toparlanamadım. Bir yerde kür yapabilir miyim?",
                ),
                "other": (
                    "{rel} için yazıyorum. Felç geçirdi, yakında hastaneden çıkacak. Sonrasında ne yapmamız gerekiyor?",
                ),
            },
        },
    ),
    Goal(
        "therapy_after_illness",
        "C",
        ("self", "other"),
        (4, 85),
        ANY_ADULT,
        docs=("e_card", "prescription", "findings"),
        weight=1.2,
        text={
            "de": {
                "self": (
                    "Ich hab seit Monaten Rückenschmerzen und der Arzt hat mir Übungen mit einem Therapeuten verschrieben. Zahlt das die Kasse oder muss ich das vorstrecken?",
                    "Meine Schulter ist nach dem Bruch steif. Ich hab eine Verordnung bekommen, aber keine Ahnung, wie das mit der Bewilligung geht.",
                ),
                "other": (
                    "Es geht um {rel_acc}. {Pron} spricht seit dem Schlaganfall undeutlich und braucht Sprachtraining. Wer zahlt das?",
                    "Es geht um {rel_acc}. {Pron} hat eine Verordnung für Behandlungen nach der Operation, aber wir finden keinen Therapeuten mit Kassenvertrag.",
                ),
            },
            "en": {
                "self": (
                    "I've had back pain for months and got a prescription for therapy sessions. Does insurance pay or do I pay first?",
                ),
                "other": (
                    "This is about {rel}. {Pron} has trouble speaking since the stroke and needs speech training. Who pays for it?",
                ),
            },
            "tr": {
                "self": (
                    "Aylardır sırt ağrım var, doktor terapi seansları yazdı. Sigorta mı öder, ben mi önce ödeyeceğim?",
                ),
                "other": (
                    "{rel} için soruyorum. Felçten sonra konuşması bozuldu, konuşma terapisine ihtiyacı var. Bunu kim öder?",
                ),
            },
        },
    ),
    Goal(
        "mental_health_support",
        "C",
        ("self",),
        (16, 75),
        ANY_ADULT,
        text={
            "de": {
                "self": (
                    "Mir geht es seit Monaten psychisch schlecht, ich kann kaum schlafen. Ich würde gern mit jemandem reden, kann mir aber privat keine Stunden leisten.",
                    "Ich hab Angstzustände und suche jemanden zum Reden, der von der Kasse bezahlt wird.",
                )
            },
            "en": {
                "self": (
                    "I've been struggling mentally for months and want to talk to someone, but I can't afford private sessions.",
                )
            },
            "tr": {
                "self": (
                    "Aylardır psikolojik olarak kötüyüm, uyuyamıyorum. Biriyle konuşmak istiyorum ama özel seanslara param yetmiyor.",
                )
            },
        },
    ),
    Goal(
        "dental_work",
        "C",
        ("self", "other"),
        (18, 90),
        ANY_ADULT,
        docs=("e_card", "invoice"),
        text={
            "de": {
                "self": (
                    "Ich brauche neue Zähne, die alte Prothese passt nicht mehr. Was zahlt die Kasse dazu?",
                    "Mir ist ein Zahn abgebrochen und der Zahnarzt will eine Krone machen. Wie viel muss ich selber zahlen?",
                ),
                "other": (
                    "Es geht um {rel_acc}. {Pron} braucht eine neue Prothese, aber das ist so teuer. Gibt es da einen Zuschuss?",
                ),
            },
            "en": {
                "self": (
                    "My old denture doesn't fit anymore and I need new teeth. How much does insurance cover?",
                ),
                "other": (
                    "This is about {rel}. {Pron} needs a new denture and it's very expensive. Is there a subsidy?",
                ),
            },
            "tr": {
                "self": (
                    "Eski protezim artık oturmuyor, yeni dişlere ihtiyacım var. Sigorta ne kadarını öder?",
                ),
                "other": (
                    "{rel} için soruyorum. Yeni protez lazım ama çok pahalı. Bir destek var mı?",
                ),
            },
        },
    ),
    Goal(
        "child_orthodontics",
        "C",
        ("parent",),
        (30, 52),
        WORKING + ("co_insured",),
        children=(1, 3, 8, 17),
        docs=("e_card", "findings"),
        text={
            "de": {
                "parent": (
                    "Mein Kind hat schiefe Zähne und der Zahnarzt meint, es braucht eine Klammer. Was übernimmt die Kasse?",
                    "Die Zähne von meiner Tochter stehen ganz schief. Gibt es da was gratis oder müssen wir alles zahlen?",
                )
            },
            "en": {
                "parent": (
                    "My child's teeth are crooked and the dentist says braces are needed. What does insurance cover?",
                )
            },
            "tr": {
                "parent": (
                    "Çocuğumun dişleri çarpık, diş hekimi tel takılması gerektiğini söyledi. Sigorta neyi karşılıyor?",
                )
            },
        },
    ),
    Goal(
        "sick_pay",
        "C",
        ("self",),
        (19, 64),
        ("employed", "employed", "marginal", "unemployed"),
        docs=("e_card", "sick_note", "payslip"),
        text={
            "de": {
                "self": (
                    "Ich bin schon seit sechs Wochen im Krankenstand und mein Chef zahlt bald nichts mehr. Wovon soll ich jetzt leben?",
                    "Ich bin länger krank geschrieben. Wer zahlt mich, wenn die Firma aufhört zu zahlen?",
                )
            },
            "en": {
                "self": (
                    "I've been on sick leave for six weeks and my employer will stop paying soon. What money do I get then?",
                )
            },
            "tr": {
                "self": (
                    "Altı haftadır raporluyum ve işverenim yakında maaş ödemeyi kesecek. Sonra neyle geçineceğim?",
                )
            },
        },
    ),
    Goal(
        "gradual_return_to_work",
        "C",
        ("self",),
        (25, 64),
        ("employed", "employed", "civil_servant"),
        docs=("e_card", "sick_note", "findings"),
        text={
            "de": {
                "self": (
                    "Ich war ein halbes Jahr krank und will langsam wieder anfangen zu arbeiten, erst mal nur ein paar Stunden. Geht das und verdiene ich dann weniger?",
                    "Nach meinem Burnout möchte ich schrittweise zurück in die Arbeit. Mein Chef wäre einverstanden. Was muss ich tun?",
                )
            },
            "en": {
                "self": (
                    "I was sick for half a year and want to go back to work part-time at first. Is there support for that?",
                )
            },
            "tr": {
                "self": (
                    "Altı ay hastaydım, işe yavaş yavaş, önce az saatle dönmek istiyorum. Bunun için bir destek var mı?",
                )
            },
        },
    ),
    Goal(
        "transport_to_treatment",
        "C",
        ("self", "other"),
        (55, 95),
        RETIRED + ("co_insured",),
        needs=True,
        docs=("e_card", "referral"),
        text={
            "de": {
                "self": (
                    "Ich muss dreimal die Woche zur Dialyse und kann nicht selbst fahren. Muss ich das Taxi selber zahlen?",
                ),
                "other": (
                    "Es geht um {rel_acc}. {Pron} muss regelmäßig zur Bestrahlung ins Spital und kann nicht mit den Öffis fahren. Wer zahlt die Fahrten?",
                ),
            },
            "en": {
                "self": (
                    "I need dialysis three times a week and can't drive. Do I have to pay for the taxi myself?",
                ),
                "other": (
                    "This is about {rel}. {Pron} has to go to hospital for treatment regularly and can't take the bus. Who pays for the rides?",
                ),
            },
            "tr": {
                "self": (
                    "Haftada üç kez diyalize gitmem gerekiyor, araba kullanamıyorum. Taksiyi kendim mi ödeyeceğim?",
                ),
                "other": (
                    "{rel} için soruyorum. Düzenli olarak hastaneye tedaviye gitmesi lazım, otobüse binemiyor. Yolculukları kim öder?",
                ),
            },
        },
    ),
    Goal(
        "private_doctor_refund",
        "C",
        ("self",),
        (20, 85),
        ANY_ADULT,
        docs=("e_card", "invoice"),
        text={
            "de": {
                "self": (
                    "Ich war bei einem Arzt ohne Kassenvertrag, weil ich sonst drei Monate gewartet hätte. Krieg ich von der Rechnung was zurück?",
                    "Ich hab eine Honorarnote von einem privaten Hautarzt. Kann ich die irgendwo einreichen?",
                )
            },
            "en": {
                "self": (
                    "I saw a doctor without an insurance contract because the wait was months. Can I get part of the bill back?",
                )
            },
            "tr": {
                "self": (
                    "Sözleşmesiz bir doktora gittim çünkü aylarca beklemem gerekecekti. Faturanın bir kısmını geri alabilir miyim?",
                )
            },
        },
    ),
    Goal(
        "treatment_abroad",
        "C",
        ("self",),
        (25, 80),
        ANY_ADULT,
        docs=("e_card", "findings", "referral"),
        weight=0.5,
        text={
            "de": {
                "self": (
                    "Eine Spezialklinik in Deutschland könnte meine Operation machen. Zahlt das meine Versicherung, wenn ich vorher frage?",
                )
            },
            "en": {
                "self": (
                    "A specialist clinic in Germany could do my operation. Will my insurance pay if I ask beforehand?",
                )
            },
            "tr": {
                "self": (
                    "Almanya'daki bir klinik ameliyatımı yapabilir. Önceden sorarsam sigortam öder mi?",
                )
            },
        },
    ),
    Goal(
        "health_coverage",
        "C",
        ("self",),
        (18, 64),
        ("uninsured", "uninsured", "student", "marginal"),
        docs=("registration",),
        income=LOW,
        text={
            "de": {
                "self": (
                    "Ich bin gerade nirgends versichert und hab nur einen kleinen Job. Wie komme ich zu einer Krankenversicherung?",
                    "Ich studiere und bin bei meinen Eltern nicht mehr mitversichert. Was mach ich jetzt?",
                )
            },
            "en": {
                "self": (
                    "I currently have no health insurance and only a small job. How can I get insured?",
                )
            },
            "tr": {
                "self": (
                    "Şu an hiçbir yerde sigortalı değilim, sadece küçük bir işim var. Nasıl sağlık sigortası yaptırabilirim?",
                )
            },
        },
    ),
    Goal(
        "aids_and_devices",
        "C",
        ("self", "other"),
        (50, 95),
        RETIRED + ANY_ADULT,
        needs=True,
        docs=("e_card", "prescription"),
        text={
            "de": {
                "self": (
                    "Ich brauche einen Rollator und vielleicht ein Pflegebett. Was zahlt die Versicherung und wo bekomme ich das?",
                ),
                "other": (
                    "Es geht um {rel_acc}. {Pron} braucht ein Hörgerät und einen Rollstuhl. Wie kommen wir dazu, ohne alles selbst zu zahlen?",
                ),
            },
            "en": {
                "self": (
                    "I need a walker and maybe a hospital bed at home. What does insurance pay for?",
                ),
                "other": (
                    "This is about {rel}. {Pron} needs a hearing aid and a wheelchair. How do we get them without paying everything?",
                ),
            },
            "tr": {
                "self": (
                    "Bir yürüteç ve belki hasta yatağı lazım. Sigorta neyi öder, nereden alırım?",
                ),
                "other": (
                    "{rel} için soruyorum. İşitme cihazı ve tekerlekli sandalye lazım. Hepsini kendimiz ödemeden nasıl alırız?",
                ),
            },
        },
    ),
    Goal(
        "holiday_treatment",
        "C",
        ("self",),
        (18, 80),
        ANY_ADULT,
        docs=("e_card", "invoice"),
        weight=0.5,
        text={
            "de": {
                "self": (
                    "Ich war im Urlaub in Kroatien krank und musste dort zum Arzt. Was mach ich mit der Rechnung?",
                )
            },
            "en": {
                "self": (
                    "I got sick on holiday in Croatia and had to see a doctor there. What do I do with the bill?",
                )
            },
            "tr": {
                "self": (
                    "Hırvatistan'da tatildeyken hastalandım ve doktora gittim. Faturayla ne yapmalıyım?",
                )
            },
        },
    ),
    # ---- Area D: care ----
    Goal(
        "care_for_parent",
        "D",
        ("other",),
        (68, 98),
        RETIRED,
        needs=True,
        docs=("e_card", "discharge_letter", "pension_notice"),
        weight=2.0,
        text={
            "de": {
                "other": (
                    "Es geht um {rel_acc}. {Pron} kommt allein nicht mehr zurecht, kann nicht mehr einkaufen und braucht Hilfe beim Waschen. Welche Unterstützung gibt es?",
                    "Es geht um {rel_acc}. Seit dem Sturz braucht {pron} jeden Tag Hilfe und ich kann das neben der Arbeit kaum stemmen. Was steht uns zu?",
                    "Es geht um {rel_acc}. {Pron} wird immer vergesslicher und kann nicht mehr allein bleiben. Wir wissen nicht, wo wir anfangen sollen.",
                )
            },
            "en": {
                "other": (
                    "This is about {rel}. {Pron} can't manage alone anymore, can't do the shopping and needs help washing. What support is there?",
                    "This is about {rel}. Since the fall {pron} needs help every day and I can barely manage it next to my job.",
                )
            },
            "tr": {
                "other": (
                    "{rel} için yazıyorum. Artık tek başına yapamıyor, alışverişe gidemiyor, yıkanırken yardım lazım. Ne gibi destekler var?",
                    "{rel} için soruyorum. Düştükten sonra her gün yardıma ihtiyacı var, ben de çalışıyorum. Bize ne hakkımız var?",
                )
            },
        },
    ),
    Goal(
        "care_for_self",
        "D",
        ("self",),
        (65, 95),
        RETIRED,
        needs=True,
        docs=("e_card", "pension_notice"),
        text={
            "de": {
                "self": (
                    "Ich bin alleinstehend und schaffe den Haushalt nicht mehr. Das Stiegensteigen geht kaum noch. Gibt es Hilfe für mich?",
                    "Ich brauch seit einem halben Jahr bei vielen Sachen Hilfe, beim Anziehen, beim Kochen. Kann ich da irgendwo Geld oder Hilfe bekommen?",
                )
            },
            "en": {
                "self": (
                    "I live alone and can't manage the housework anymore, stairs are very hard. Is there any help for me?",
                )
            },
            "tr": {
                "self": (
                    "Yalnız yaşıyorum, ev işlerini artık yapamıyorum, merdiven çıkmak çok zor. Bana bir yardım var mı?",
                )
            },
        },
    ),
    Goal(
        "care_leave",
        "D",
        ("self",),
        (30, 64),
        ("employed", "employed", "civil_servant"),
        docs=("e_card", "payslip"),
        text={
            "de": {
                "self": (
                    "Mein Vater ist schwer krank und ich will ein paar Monate weniger oder gar nicht arbeiten, um ihn zu pflegen. Wie geht das, ohne dass ich ohne Geld dasteh?",
                    "Ich möchte mir von der Arbeit freinehmen, um meine Mutter zu pflegen. Mein Chef weiß noch nichts. Was sind meine Möglichkeiten?",
                )
            },
            "en": {
                "self": (
                    "My father is seriously ill and I want to work less or stop for a few months to care for him. How do I do that without losing all income?",
                )
            },
            "tr": {
                "self": (
                    "Babam ağır hasta, ona bakmak için birkaç ay daha az çalışmak ya da hiç çalışmamak istiyorum. Gelirsiz kalmadan bu nasıl olur?",
                )
            },
        },
    ),
    Goal(
        "home_care_24h",
        "D",
        ("other",),
        (75, 99),
        RETIRED,
        needs=True,
        docs=("e_card", "care_decision", "pension_notice"),
        text={
            "de": {
                "other": (
                    "Es geht um {rel_acc}. {Pron} braucht jetzt rund um die Uhr jemanden im Haus. Wir überlegen, eine Betreuerin aus der Slowakei zu holen. Gibt es dafür Zuschüsse?",
                )
            },
            "en": {
                "other": (
                    "This is about {rel}. {Pron} now needs someone in the house around the clock. We're thinking about a live-in carer. Is there financial help?",
                )
            },
            "tr": {
                "other": (
                    "{rel} için soruyorum. Artık gece gündüz evde birinin olması lazım. Yatılı bakıcı düşünüyoruz. Bunun için bir destek var mı?",
                )
            },
        },
    ),
    # ---- Area E: financial support (held-out family) ----
    Goal(
        "family_allowance",
        "E",
        ("parent",),
        (19, 45),
        WORKING + ("parental_leave", "co_insured", "student"),
        children=(1, 3, 0, 18),
        docs=("birth_certificate", "registration"),
        text={
            "de": {
                "parent": (
                    "Wir sind vor kurzem nach Österreich gezogen und haben zwei Kinder. Bekommen wir für die Kinder monatlich was?",
                    "Mein Sohn ist 18 geworden und macht noch Matura. Kriegen wir für ihn weiter Geld?",
                )
            },
            "en": {
                "parent": (
                    "We recently moved to Austria with two kids. Is there a monthly payment for children?",
                )
            },
            "tr": {
                "parent": (
                    "Yakın zamanda iki çocuğumuzla Avusturya'ya taşındık. Çocuklar için aylık bir ödeme alabilir miyiz?",
                )
            },
        },
    ),
    Goal(
        "childcare_allowance",
        "E",
        ("parent",),
        (20, 44),
        WORKING + ("parental_leave", "unemployed", "student"),
        children=(1, 2, 0, 1),
        docs=("birth_certificate", "payslip", "e_card"),
        text={
            "de": {
                "parent": (
                    "Unser Baby ist vor drei Wochen auf die Welt gekommen und ich bleibe zu Hause. Wovon leben wir in der Karenz?",
                    "Ich bin gerade Mama geworden. Welches Geld bekomme ich, solange ich beim Kind daheim bin?",
                )
            },
            "en": {
                "parent": (
                    "Our baby was born three weeks ago and I'm staying at home. What money do we get while I'm on leave?",
                )
            },
            "tr": {
                "parent": (
                    "Bebeğimiz üç hafta önce doğdu, ben evde kalıyorum. İzindeyken hangi parayı alırız?",
                )
            },
        },
    ),
    Goal(
        "prescription_fee_relief",
        "E",
        ("self", "other"),
        (55, 95),
        RETIRED + ("unemployed",),
        income=LOW,
        docs=("e_card", "pension_notice", "prescription"),
        text={
            "de": {
                "self": (
                    "Ich hab nur eine kleine Pension und muss jeden Monat für meine Medikamente zahlen. Gibt es da eine Erleichterung?",
                ),
                "other": (
                    "Es geht um {rel_acc}. {Pron} hat wenig Pension und braucht sieben verschiedene Medikamente. Muss {pron} das alles zahlen?",
                ),
            },
            "en": {
                "self": (
                    "I have a small pension and pay for my medicines every month. Is there any relief?",
                ),
                "other": (
                    "This is about {rel}. {Pron} has a small pension and takes seven medicines. Does {pron} have to pay for all of them?",
                ),
            },
            "tr": {
                "self": (
                    "Emekli maaşım çok az, her ay ilaçlarım için ödeme yapıyorum. Bir kolaylık var mı?",
                ),
                "other": (
                    "{rel} için soruyorum. Emekli maaşı az, yedi farklı ilaç kullanıyor. Hepsini kendisi mi ödeyecek?",
                ),
            },
        },
    ),
    Goal(
        "basic_income_support",
        "E",
        ("self",),
        (19, 70),
        ("unemployed", "unemployed", "marginal", "uninsured"),
        income=("lt_1300",),
        docs=("registration", "e_card"),
        text={
            "de": {
                "self": (
                    "Ich hab keine Arbeit mehr, das Arbeitslosengeld reicht nicht für die Miete. Wo kann ich um Hilfe ansuchen?",
                    "Ich komm mit dem Geld hinten und vorne nicht aus. Gibt es vom Land irgendeine Unterstützung zum Leben?",
                )
            },
            "en": {
                "self": (
                    "I lost my job and the unemployment money doesn't cover rent. Where can I apply for help?",
                )
            },
            "tr": {
                "self": (
                    "İşimi kaybettim, işsizlik parası kiraya yetmiyor. Nereden yardım isteyebilirim?",
                )
            },
        },
    ),
    Goal(
        "disability_child",
        "D",
        ("parent",),
        (25, 55),
        WORKING + ("co_insured", "parental_leave"),
        children=(1, 2, 2, 17),
        weight=0.6,
        text={
            "de": {
                "parent": (
                    "Mein Kind hat seit der Geburt eine schwere Beeinträchtigung und braucht ständig Betreuung. Welche Unterstützung gibt es für uns?",
                    "Bei unserer Tochter wurde eine Behinderung festgestellt. Sie braucht viel mehr Hilfe als andere Kinder. Was steht uns zu?",
                )
            },
            "en": {
                "parent": (
                    "My child has had a severe disability since birth and needs constant care. What support is there for us?",
                )
            },
            "tr": {
                "parent": (
                    "Çocuğumun doğuştan ağır bir engeli var ve sürekli bakım gerekiyor. Bize ne gibi destekler var?",
                )
            },
        },
    ),
    # ---- Area F: counselling and hardship ----
    Goal(
        "family_counselling",
        "F",
        ("parent",),
        (22, 55),
        ANY_ADULT,
        children=(1, 3, 2, 17),
        weight=0.6,
        text={
            "de": {
                "parent": (
                    "Bei uns zu Hause gibt es ständig Streit, auch wegen der Kinder. Gibt es eine Beratung, die nicht viel kostet?",
                )
            },
            "en": {
                "parent": (
                    "We argue all the time at home, also about the kids. Is there affordable counselling?",
                )
            },
            "tr": {
                "parent": (
                    "Evde sürekli kavga ediyoruz, çocuklar yüzünden de. Ucuz bir danışmanlık var mı?",
                )
            },
        },
    ),
    Goal(
        "hardship_health_costs",
        "F",
        ("self",),
        (25, 85),
        ANY_ADULT,
        income=LOW,
        docs=("e_card", "invoice"),
        weight=0.7,
        text={
            "de": {
                "self": (
                    "Ich hab hohe Kosten für eine Behandlung, die nur zum Teil gezahlt wird, und kaum Einkommen. Gibt es in Notlagen einen Zuschuss?",
                )
            },
            "en": {
                "self": (
                    "I have high treatment costs that are only partly covered and very little income. Is there hardship support?",
                )
            },
            "tr": {
                "self": (
                    "Kısmen karşılanan yüksek tedavi masraflarım var ve gelirim çok az. Zor durumdakiler için bir destek var mı?",
                )
            },
        },
    ),
)

GOALS_BY_ID = {g.id: g for g in GOALS}

# Scenario -> (goal benefit id for `POST /gold`, life situation of the bundle).
TARGETS: dict[str, tuple[str, str]] = {
    "get_health_checkup": ("praevention-vorsorgeuntersuchung", "prevention"),
    "cancer_screening": ("praevention-darmkrebs-frueherkennung", "prevention"),
    "adult_vaccination": ("praevention-impfprogramm-ab-60", "prevention"),
    "child_vaccination": ("familie-kinderimpfprogramm", "family-with-child"),
    "pregnancy_checks": ("familie-eltern-kind-pass", "family-with-child"),
    "healthy_lifestyle": ("praevention-ernaehrungsberatung", "prevention"),
    "rehab_after_hospital": ("medical-rehabilitation", "after-hospital"),
    "therapy_after_illness": ("oegk-physiotherapie", "illness"),
    "mental_health_support": ("oegk-psychotherapie", "illness"),
    "dental_work": ("oegk-zahnersatz", "illness"),
    "child_orthodontics": ("oegk-zahnspange", "illness"),
    "sick_pay": ("oegk-krankengeld", "illness"),
    "gradual_return_to_work": ("oegk-wiedereingliederungsgeld", "illness"),
    "transport_to_treatment": ("oegk-transportkosten", "illness"),
    "private_doctor_refund": ("oegk-wahlarzt-kostenerstattung", "illness"),
    "treatment_abroad": ("oegk-geplante-auslandsbehandlung", "illness"),
    "health_coverage": ("oegk-selbstversicherung", "uninsured"),
    "aids_and_devices": ("heilbehelfe-hilfsmittel", "after-hospital"),
    "holiday_treatment": ("oegk-urlaubsbehandlung", "illness"),
    "care_for_parent": ("pflegegeld", "care"),
    "care_for_self": ("pflegegeld", "care"),
    "care_leave": ("pflegekarenz", "care"),
    "home_care_24h": ("pflege-24-stunden-betreuung", "care"),
    "disability_child": ("familie-familienbeihilfe", "disability"),
    "family_allowance": ("familie-familienbeihilfe", "family-with-child"),
    "childcare_allowance": ("familie-kinderbetreuungsgeld", "family-with-child"),
    "prescription_fee_relief": ("rezeptgebuehrenbefreiung", "low-income"),
    "basic_income_support": ("sozialhilfe-wien", "low-income"),
    "family_counselling": ("familie-familienberatung", "family-with-child"),
    "hardship_health_costs": ("oegk-unterstuetzungsfonds", "illness"),
}
assert set(TARGETS) == set(GOALS_BY_ID), set(TARGETS) ^ set(GOALS_BY_ID)
