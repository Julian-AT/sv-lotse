"""Synthetic identity layer and confirmed facts with provenance for one AT-Benefits persona.

The persona card (age, sex, residence, carrier, employment, care level, helper, documents held)
is the anchor; names, addresses, numbers and contact details are sampled deterministically from the
persona id. No real person: names come from common-name pools, streets are generic, phone numbers
use the Austrian mobile range with random digits, e-mail domains are reserved (`example.*`),
insurance numbers carry a valid check digit and the birth date of the persona, IBANs a valid
MOD-97 checksum.

Facts mirror the product's `fact` rows: `type`, `value`, `confirmed`, `source` (kind statement with
turn id and quote, or kind document with document id and quote), `documentId`, `turnId`. Policy
edge cases are sampled on purpose: document-only IBANs (must stay empty), unconfirmed facts,
conflicting confirmed facts (ambiguous, must stay empty), missing optional facts and values that
violate a field's validation (for example a spaced IBAN in a 20-character field).
"""

from __future__ import annotations

import datetime as dt
import random
import uuid

NS = uuid.UUID("0b6d5d8e-61c9-4a7e-9a9b-3f2e7d4c1a00")
TODAY = dt.date(2026, 11, 6)

NAMES = {
    "de": (
        [
            "Anna",
            "Maria",
            "Elisabeth",
            "Johanna",
            "Katharina",
            "Theresa",
            "Lena",
            "Sophie",
            "Hannelore",
            "Gertraud",
            "Brigitte",
            "Renate",
            "Sabine",
            "Ingrid",
            "Christine",
            "Lea",
            "Marlene",
            "Valentina",
            "Hermine",
            "Rosa",
        ],
        [
            "Johann",
            "Josef",
            "Franz",
            "Karl",
            "Michael",
            "Thomas",
            "Stefan",
            "Andreas",
            "Lukas",
            "Florian",
            "Gerhard",
            "Herbert",
            "Wolfgang",
            "Alois",
            "Leopold",
            "Matthias",
            "Jakob",
            "Maximilian",
            "Günther",
            "Engelbert",
        ],
        [
            "Gruber",
            "Huber",
            "Bauer",
            "Wagner",
            "Müller",
            "Pichler",
            "Steiner",
            "Moser",
            "Mayer",
            "Hofer",
            "Leitner",
            "Berger",
            "Fuchs",
            "Eder",
            "Fischer",
            "Schmid",
            "Winkler",
            "Weber",
            "Schwarz",
            "Maier",
            "Reiter",
            "Brunner",
            "Lang",
            "Baumgartner",
            "Auer",
            "Wimmer",
            "Egger",
            "Lechner",
            "Holzer",
            "Strobl",
            "Größinger",
            "Pölzl",
            "Öhlinger",
            "Kößler",
        ],
    ),
    "tr": (
        ["Ayşe", "Fatma", "Emine", "Hatice", "Zeynep", "Elif", "Merve", "Şeyma", "Gülsüm", "Büşra"],
        [
            "Mehmet",
            "Mustafa",
            "Ahmet",
            "Ali",
            "Hüseyin",
            "Hasan",
            "İbrahim",
            "Murat",
            "Emre",
            "Yusuf",
        ],
        [
            "Yılmaz",
            "Kaya",
            "Demir",
            "Şahin",
            "Çelik",
            "Yıldız",
            "Öztürk",
            "Aydın",
            "Özdemir",
            "Arslan",
            "Doğan",
            "Koç",
        ],
    ),
    "bcs": (
        [
            "Ana",
            "Jelena",
            "Ivana",
            "Marija",
            "Snježana",
            "Dragana",
            "Amra",
            "Lejla",
            "Mirjana",
            "Željka",
        ],
        [
            "Marko",
            "Nikola",
            "Ivan",
            "Dragan",
            "Goran",
            "Emir",
            "Adnan",
            "Željko",
            "Dušan",
            "Branko",
        ],
        [
            "Kovačević",
            "Petrović",
            "Jovanović",
            "Horvat",
            "Babić",
            "Hodžić",
            "Marić",
            "Novak",
            "Đurić",
            "Begić",
            "Šarić",
            "Vuković",
        ],
    ),
    "ro": (
        ["Ioana", "Elena", "Andreea", "Mihaela", "Gabriela", "Ștefania"],
        ["Ion", "Andrei", "Mihai", "Ștefan", "Florin", "Bogdan"],
        ["Popescu", "Ionescu", "Popa", "Dumitru", "Stoica", "Constantinescu", "Mureșan", "Țurcanu"],
    ),
    "hu": (
        ["Katalin", "Erzsébet", "Ildikó", "Zsuzsanna", "Éva", "Anikó"],
        ["László", "István", "József", "Zoltán", "Gábor", "Ferenc"],
        [
            "Nagy",
            "Kovács",
            "Tóth",
            "Szabó",
            "Horváth",
            "Varga",
            "Kiss",
            "Molnár",
            "Németh",
            "Farkas",
            "Balogh",
            "Szőke",
        ],
    ),
    "pl": (
        ["Anna", "Katarzyna", "Małgorzata", "Agnieszka", "Barbara", "Joanna"],
        ["Piotr", "Krzysztof", "Andrzej", "Tomasz", "Paweł", "Łukasz"],
        [
            "Nowak",
            "Kowalski",
            "Wiśniewski",
            "Wójcik",
            "Kamiński",
            "Lewandowski",
            "Zieliński",
            "Szymański",
            "Woźniak",
            "Dąbrowski",
        ],
    ),
    "uk": (
        ["Olena", "Iryna", "Nataliia", "Oksana", "Tetiana", "Yuliia"],
        ["Oleksandr", "Serhii", "Andrii", "Volodymyr", "Mykola", "Dmytro"],
        [
            "Shevchenko",
            "Kovalenko",
            "Bondarenko",
            "Tkachenko",
            "Kravchenko",
            "Melnyk",
            "Oliinyk",
            "Koval",
        ],
    ),
    "ar": (
        ["Fatima", "Aisha", "Mariam", "Noor", "Huda", "Rania"],
        ["Mohammad", "Ahmad", "Omar", "Khaled", "Youssef", "Hassan"],
        ["Al-Hassan", "Haddad", "Khalil", "Nasser", "Saleh", "Mansour", "Ibrahim", "Darwish"],
    ),
    "en": (
        ["Emily", "Sarah", "Olivia", "Grace"],
        ["James", "Daniel", "Oliver", "Thomas"],
        ["Smith", "Brown", "Taylor", "Wilson", "O'Connor", "Walsh"],
    ),
}
BIRTH_COUNTRY = {
    "de": "Österreich",
    "tr": "Türkei",
    "bcs": "Bosnien und Herzegowina",
    "ro": "Rumänien",
    "hu": "Ungarn",
    "pl": "Polen",
    "uk": "Ukraine",
    "ar": "Syrien",
    "en": "Vereinigtes Königreich",
}
NATIONALITY = {
    "tr": "Türkei",
    "bcs": "Serbien",
    "ro": "Rumänien",
    "hu": "Ungarn",
    "pl": "Polen",
    "uk": "Ukraine",
    "ar": "Syrien",
    "en": "Vereinigtes Königreich",
}
TITLES = ["Dr.", "Mag.", "DI", "Ing.", "MMag.", "Dr.in", "Mag.a", "BEd", "DDr."]
FEMALE_TITLES = {"Dr.in", "Mag.a"}
STREETS = [
    "Hauptstraße",
    "Bahnhofstraße",
    "Kirchengasse",
    "Schulgasse",
    "Lindenweg",
    "Feldgasse",
    "Gartengasse",
    "Mühlweg",
    "Dorfstraße",
    "Wiener Straße",
    "Grazer Straße",
    "Am Anger",
    "Rosengasse",
    "Siedlungsstraße",
    "Bergstraße",
    "Ringstraße",
    "Waldweg",
    "Quellenstraße",
    "Erlengasse",
    "Sonnenweg",
]
CITIES = {
    "Wien": [("Wien", None)],
    "Niederösterreich": [
        ("St. Pölten", "3100"),
        ("Wiener Neustadt", "2700"),
        ("Amstetten", "3300"),
        ("Baden", "2500"),
        ("Zwettl", "3910"),
        ("Mödling", "2340"),
    ],
    "Oberösterreich": [
        ("Linz", "4020"),
        ("Wels", "4600"),
        ("Steyr", "4400"),
        ("Ried im Innkreis", "4910"),
        ("Freistadt", "4240"),
        ("Gmunden", "4810"),
    ],
    "Steiermark": [
        ("Graz", "8010"),
        ("Leoben", "8700"),
        ("Bruck an der Mur", "8600"),
        ("Weiz", "8160"),
        ("Liezen", "8940"),
        ("Feldbach", "8330"),
    ],
    "Tirol": [
        ("Innsbruck", "6020"),
        ("Kufstein", "6330"),
        ("Lienz", "9900"),
        ("Imst", "6460"),
        ("Schwaz", "6130"),
    ],
    "Kärnten": [
        ("Klagenfurt am Wörthersee", "9020"),
        ("Villach", "9500"),
        ("Wolfsberg", "9400"),
        ("Spittal an der Drau", "9800"),
    ],
    "Salzburg": [
        ("Salzburg", "5020"),
        ("Hallein", "5400"),
        ("Saalfelden am Steinernen Meer", "5760"),
        ("Zell am See", "5700"),
    ],
    "Vorarlberg": [
        ("Bregenz", "6900"),
        ("Dornbirn", "6850"),
        ("Feldkirch", "6800"),
        ("Bludenz", "6700"),
    ],
    "Burgenland": [
        ("Eisenstadt", "7000"),
        ("Oberwart", "7400"),
        ("Neusiedl am See", "7100"),
        ("Güssing", "7540"),
    ],
}
CARRIER = {"oegk": "ÖGK", "svs": "SVS", "bvaeb": "BVAEB"}
PENSION = {"pva": "Pensionsversicherungsanstalt", "svs": "SVS", "bvaeb": "BVAEB"}
EMPLOYERS = [
    "Muster Bau GmbH",
    "Alpen Logistik GmbH",
    "Gemeinde {city}",
    "Stadtwerke {city}",
    "Donau Handel KG",
    "Pflegezentrum {city}",
    "Bäckerei Beispiel OG",
    "Beispiel Reinigung GmbH",
    "Österreichische Post AG",
    "Spar-Markt {city}",
]
DOCS = {
    "e-card": ("e-card", ["person.insurance_number", "person.name"]),
    "meldezettel": (
        "Meldezettel",
        ["address.full", "address.street", "address.postcode", "address.city", "person.birth_date"],
    ),
    "pension-notice": ("Pensionsbescheid", ["insurance.pension_carrier", "bank.iban"]),
    "care-notice": ("Pflegegeldbescheid", ["care.level", "care.paying_office"]),
    "bank-card": ("Kontoauszug", ["bank.iban", "bank.account_holder", "bank.name"]),
}
BANKS = [
    ("Erste Bank", "20111"),
    ("Raiffeisenbank", "32000"),
    ("BAWAG P.S.K.", "60000"),
    ("Bank Austria", "12000"),
    ("Volksbank", "43000"),
    ("Oberbank", "15000"),
]
MARITAL = ["ledig", "verheiratet", "geschieden", "verwitwet", "in eingetragener Partnerschaft"]


def _svnr(rng: random.Random, birth: dt.date) -> str:
    weights = (3, 7, 9, 0, 5, 8, 4, 2, 1, 6)
    date = birth.strftime("%d%m%y")
    while True:
        serial = f"{rng.randint(100, 999)}"
        digits = [int(c) for c in serial + "0" + date]
        check = sum(w * d for w, d in zip(weights, digits, strict=True)) % 11
        if check < 10:
            return f"{serial}{check}{date}"


def valid_svnr(value: str) -> bool:
    if len(value) != 10 or not value.isdigit():
        return False
    weights = (3, 7, 9, 0, 5, 8, 4, 2, 1, 6)
    digits = [int(c) for c in value]
    return sum(w * d for w, d in zip(weights, digits, strict=True)) % 11 == digits[3]


def _iban(rng: random.Random, bank_code: str) -> str:
    account = f"{rng.randint(0, 10**11 - 1):011d}"
    bban = bank_code + account
    numeric = int(bban + "102900")  # A=10, T=29, then "00"
    check = 98 - numeric % 97
    return f"AT{check:02d}{bban}"


def valid_iban(value: str) -> bool:
    v = value.replace(" ", "")
    if not v.startswith("AT") or len(v) != 20:
        return False
    moved = v[4:] + v[:4]
    num = "".join(str(int(c, 36)) for c in moved)
    return int(num) % 97 == 1


def _phone(rng: random.Random) -> str:
    prefix = rng.choice(["650", "660", "664", "676", "680", "681", "699"])
    return f"+43{prefix}{rng.randint(1000000, 9999999)}"


def _ascii(s: str) -> str:
    table = str.maketrans(
        {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "'": ""}
    )
    import unicodedata

    s = s.translate(table)
    return "".join(c for c in unicodedata.normalize("NFKD", s) if c.isascii() and c.isalnum())


def _origin(rng: random.Random, language: str) -> str:
    if language.startswith("tr"):
        return "tr"
    if language.startswith("en"):
        return rng.choice(["en", "de", "uk", "ar", "ro"])
    return rng.choices(
        ["de", "bcs", "tr", "ro", "hu", "pl", "uk", "ar"], weights=[66, 9, 6, 5, 4, 4, 3, 3]
    )[0]


def _birth(rng: random.Random, age: int) -> dt.date:
    """A birth date such that the person is exactly `age` years old today."""
    try:
        anniversary = TODAY.replace(year=TODAY.year - age)
    except ValueError:  # 29 February
        anniversary = dt.date(TODAY.year - age, 2, 28)
    return anniversary - dt.timedelta(days=rng.randrange(0, 365))


def _person(rng: random.Random, origin: str, sex: str, age: int) -> dict:
    female, male, family = NAMES[origin]
    given = rng.choice(female if sex == "f" else male if sex == "m" else female + male)
    if origin == "de" and rng.random() < 0.04:
        pool = female if given in female else male
        second = rng.choice(pool)
        if second != given:
            given = f"{given}-{second}"
    fam = rng.choice(family)
    if rng.random() < 0.05:
        fam = f"{fam}-{rng.choice(NAMES['de'][2])}"
    titles = [t for t in TITLES if sex == "f" or t not in FEMALE_TITLES]
    title = rng.choice(titles) if age >= 25 and rng.random() < 0.12 else None
    return {"given": given, "family": fam, "title": title, "birth": _birth(rng, max(age, 0))}


def build_identity(persona: dict, seed: int = 0) -> dict:
    """Deterministic identity for one persona (persona = parsed dataset row)."""
    pid = persona["id"]
    rng = random.Random(f"{pid}:{seed}")
    household = persona["household"]
    subject = next(m for m in household if m["role"] == "subject")
    helper = next((m for m in household if m["role"] == "helper"), None)
    origin = _origin(rng, subject.get("language", "de-AT"))
    me = _person(rng, origin, subject["sex"], subject["age"])
    state = subject["residence"]["state"]
    district = subject["residence"].get("district")
    city, plz = rng.choice(CITIES.get(state, CITIES["Wien"]))
    if city == "Wien":
        d = district if isinstance(district, int) else rng.randint(1, 23)
        plz = f"1{d:02d}0"
        district = d
    street = rng.choice(STREETS)
    house = str(rng.randint(1, 180))
    stair = str(rng.randint(1, 6)) if city == "Wien" and rng.random() < 0.4 else None
    door = str(rng.randint(1, 40)) if rng.random() < 0.7 else None
    unit = "/".join(x for x in (house, stair, door) if x)
    marital = rng.choice(MARITAL[:1] if subject["age"] < 20 else MARITAL)
    if marital == "verwitwet" and subject["age"] < 40:
        marital = "verheiratet"
    married_since = None
    if marital != "ledig":
        earliest = me["birth"] + dt.timedelta(days=365 * 19)
        span = max((TODAY - earliest).days, 1)
        married_since = earliest + dt.timedelta(days=rng.randrange(span))
    bank_name, bank_code = rng.choice(BANKS)
    carrier = subject["insurance"].get("carrier")
    pension = subject["insurance"].get("pension_carrier")
    care = subject.get("care", {}).get("pflegegeld_level")
    identity = {
        "origin": origin,
        "given": me["given"],
        "family": me["family"],
        "title": me["title"],
        "birth": me["birth"],
        "sex": subject["sex"],
        "age": subject["age"],
        "svnr": _svnr(rng, me["birth"]),
        "marital": marital,
        "married_since": married_since,
        "previous_names": rng.choice(NAMES[origin][2])
        if (subject["sex"] == "f" and marital != "ledig" and rng.random() < 0.4)
        else None,
        "birth_country": BIRTH_COUNTRY[origin] if rng.random() < 0.85 else "Österreich",
        "nationality": NATIONALITY.get(origin) if rng.random() < 0.6 else None,
        "street": street,
        "house": house,
        "stair": stair,
        "door": door,
        "unit": unit,
        "postcode": plz,
        "city": city,
        "district": district,
        "state": state,
        "phone": _phone(rng),
        "email": None,
        "iban": _iban(rng, bank_code),
        "bank_name": bank_name,
        "carrier": CARRIER.get(carrier) if carrier else None,
        "pension_carrier": PENSION.get(pension)
        if pension
        else ("Pensionsversicherungsanstalt" if subject["employment"] == "retired" else None),
        "care_level": str(care) if care else None,
        "employment": subject["employment"],
        "employer": rng.choice(EMPLOYERS).format(city=city)
        if subject["employment"] in ("employed", "marginal_employment")
        else None,
        "documents_held": subject.get("documents_held", []),
        "application_date": TODAY - dt.timedelta(days=rng.randrange(0, 60)),
        "children": subject.get("children", []),
    }
    if subject["age"] < 75 or rng.random() < 0.3:
        local = f"{_ascii(me['given']).lower()}.{_ascii(me['family']).lower()}"
        identity["email"] = f"{local}{rng.randint(1, 99) if rng.random() < 0.4 else ''}@" + (
            rng.choice(["example.at", "example.com", "example.org", "example.net"])
        )
    if helper or rng.random() < 0.15:
        h_origin = origin if rng.random() < 0.8 else "de"
        hp = _person(
            rng,
            h_origin,
            (helper or {}).get("sex", rng.choice("fm")),
            (helper or {}).get("age", 45),
        )
        identity["helper"] = {
            "given": hp["given"],
            "family": hp["family"] if rng.random() < 0.3 else me["family"],
            "title": hp["title"],
            "phone": _phone(rng),
            "email": f"{_ascii(hp['given']).lower()}@example.org",
            "relationship": rng.choice(
                [
                    "Tochter",
                    "Sohn",
                    "Ehefrau",
                    "Ehemann",
                    "Enkelin",
                    "Nichte",
                    "Erwachsenenvertreterin",
                ]
            ),
            "address": f"{rng.choice(STREETS)} {rng.randint(1, 90)}, {plz} {city}",
        }
    if subject["insurance"].get("status") in ("co-insured", "dependent"):
        # The main insured person: a parent for young dependants, else the spouse/partner.
        if subject["age"] < 27:
            sex = rng.choice("fm")
            ip = _person(rng, origin, sex, subject["age"] + rng.randint(22, 38))
            relationship = "Mutter" if sex == "f" else "Vater"
        else:
            sex = "m" if subject["sex"] == "f" else "f"
            ip = _person(rng, origin, sex, max(subject["age"] + rng.randint(-5, 8), 20))
            married = identity["marital"] in ("verheiratet", "in eingetragener Partnerschaft")
            relationship = (
                ("Ehegattin" if sex == "f" else "Ehegatte")
                if married
                else ("Lebensgefährtin" if sex == "f" else "Lebensgefährte")
            )
        identity["insured"] = {
            "name": f"{ip['given']} {me['family']}",
            "svnr": _svnr(rng, ip["birth"]),
            "relationship": relationship,
            "employer": rng.choice(EMPLOYERS).format(city=city),
        }
    return identity


def _name(i: dict) -> str:
    return f"{i['given']} {i['family']}"


def fact_values(i: dict, rng: random.Random) -> dict[str, object]:
    """Fact type -> value, the subject's administrative facts (absent keys = unknown)."""
    name = _name(i)
    full = f"{i['street']} {i['unit']}, {i['postcode']} {i['city']}"
    v: dict[str, object] = {
        "person.given_name": i["given"],
        "person.family_name": i["family"],
        "person.name": name,
        "person.name_family_first": ", ".join(
            x for x in ((f"{i['title']} " if i["title"] else "") + i["family"], i["given"]) if x
        ),
        "person.family_name_title": f"{i['family']}, {i['title']}" if i["title"] else i["family"],
        "person.birth_date": i["birth"].isoformat(),
        "person.gender": {"f": "weiblich", "m": "männlich"}.get(i["sex"], "divers"),
        "person.marital_status": i["marital"],
        "person.birth_country": i["birth_country"],
        "person.insurance_number": i["svnr"],
        "address.street": i["street"],
        "address.house_number": i["house"],
        "address.building_unit": i["unit"],
        "address.postcode": i["postcode"],
        "address.city": i["city"],
        "address.country": "Österreich",
        "address.full": full,
        "contact.phone": i["phone"],
        "application.date": i["application_date"].isoformat(),
        "application.place_date": f"{i['city']}, {i['application_date'].strftime('%d.%m.%Y')}",
        "signatory.printed_name": name,
        "bank.account_holder": name,
        "bank.name": i["bank_name"],
        "household.adults": str(
            1 + (i["marital"] in ("verheiratet", "in eingetragener Partnerschaft"))
        ),
    }
    opt = {
        "person.title": i["title"],
        "person.previous_names": i["previous_names"],
        "person.other_nationality": i["nationality"],
        "person.marital_status_since": i["married_since"].isoformat()
        if i["married_since"]
        else None,
        "address.stair": i["stair"],
        "address.door": i["door"],
        "contact.email": i["email"],
        "insurance.carrier": i["carrier"],
        "insurance.pension_carrier": i["pension_carrier"],
        "care.level": i["care_level"],
        "care.paying_office": i["pension_carrier"] if i["care_level"] else None,
        "insured.employer": (i.get("insured") or {}).get("employer") or i["employer"],
    }
    v.update({k: x for k, x in opt.items() if x})
    ins = i.get("insured")
    v["insured.name"] = ins["name"] if ins else name
    v["insured.insurance_number"] = ins["svnr"] if ins else i["svnr"]
    v["insured.address"] = full
    if ins:
        v["insured.relationship"] = ins["relationship"]
    if i["care_level"]:
        v["care.customer_number"] = f"K{rng.randint(100000, 999999)}"
    if i["employment"] == "unemployed":
        v["insurance.ams_office"] = f"AMS {i['city']}"
        v["employment.end_date"] = (TODAY - dt.timedelta(days=rng.randrange(30, 700))).isoformat()
    if i["city"] == "Wien":
        urgent = rng.random() < 0.4
        v["housing.urgent"] = urgent
        v["housing.can_wait"] = not urgent
        districts = sorted(rng.sample(range(1, 24), rng.randint(1, 3)))
        key = "housing.preferred_districts" if urgent else "housing.waiting_districts"
        v[key] = ", ".join(str(d) for d in districts)
        v["application.home_support"] = bool(i["care_level"]) and rng.random() < 0.6
        v["application.day_support"] = rng.random() < 0.2
        v["application.shared_housing"] = rng.random() < 0.2
    h = i.get("helper")
    v["contact.self"] = not h
    v["contact.other"] = bool(h)
    if h:
        v["representative.given_name"] = h["given"]
        v["representative.family_name"] = h["family"]
        v["representative.family_name_title"] = (
            f"{h['family']}, {h['title']}" if h["title"] else h["family"]
        )
        v["representative.phone"] = h["phone"]
        v["representative.email"] = h["email"]
        v["representative.address"] = h["address"]
        v["contact.delegate_name"] = f"{h['given']} {h['family']}"
        v["contact.delegate_phone"] = h["phone"]
        v["contact.delegate_email"] = h["email"]
    # Travel-cost facts are administrative (who, how, how much), never clinical.
    v["travel.provider"] = rng.choice(
        [
            f"Ambulanz Klinikum {i['city']}",
            f"Gruppenpraxis {i['city']}",
            f"Physikalisches Institut {i['city']}",
            f"Dialysezentrum {i['city']}",
        ]
    )
    v["travel.documented_purpose"] = rng.choice(
        ["ambulante Behandlung", "Kontrolltermin", "Therapie laut ärztlicher Verordnung"]
    )
    v["travel.transport_option"] = rng.choice(["Auswahl1", "Auswahl2", "Auswahl3"])
    v["travel.companion_option"] = rng.choice(["Auswahl1", "Auswahl2"])
    v["travel.cost"] = f"{rng.randint(3, 60)},{rng.choice(['00', '20', '40', '60', '80'])}"
    return v


STATEMENT_TEMPLATES = [
    "Meine Angabe zu {label}: {value}.",
    "{label}? Das ist {value}.",
    "Bitte tragen Sie bei {label} {value} ein.",
    "Ja, {value} stimmt so ({label}).",
]
LABELS_DE = {
    "person.given_name": "Vorname",
    "person.family_name": "Familienname",
    "person.name": "Name",
    "person.birth_date": "Geburtsdatum",
    "person.insurance_number": "Versicherungsnummer",
    "address.full": "Adresse",
    "contact.phone": "Telefonnummer",
    "contact.email": "E-Mail",
    "bank.iban": "IBAN",
    "application.date": "Datum",
    "person.marital_status": "Familienstand",
}


def _quote(rng: random.Random, ftype: str, value: object) -> str:
    label = LABELS_DE.get(ftype, ftype.split(".")[-1].replace("_", " "))
    shown = ("ja" if value else "nein") if isinstance(value, bool) else value
    return rng.choice(STATEMENT_TEMPLATES).format(label=label, value=shown)


def build_facts(persona: dict, seed: int = 0) -> tuple[dict, list[dict], dict]:
    """Return (identity, facts, noise) for a persona; facts are product-shaped fact rows."""
    identity = build_identity(persona, seed)
    rng = random.Random(f"facts:{persona['id']}:{seed}")
    values = fact_values(identity, rng)
    subject_key = persona["id"]

    def fid(*parts: object) -> str:
        return str(uuid.uuid5(NS, ":".join(str(p) for p in (subject_key, seed, *parts))))

    turn = fid("turn", 0)
    held = set(identity["documents_held"])
    doc_for: dict[str, tuple[str, str]] = {}
    for key, (title, types) in DOCS.items():
        if (
            key in held
            or (key == "e-card" and rng.random() < 0.5)
            or (key == "meldezettel" and rng.random() < 0.3)
        ):
            for t in types:
                doc_for.setdefault(t, (fid("doc", key), title))

    facts: list[dict] = []
    noise = {"iban": None, "unconfirmed": [], "conflict": [], "dropped": [], "document": []}

    def add(ftype: str, value: object, *, confirmed=True, document=None, tag=0):
        if document:
            doc_id, title = document
            source = {
                "kind": "document",
                "documentId": doc_id,
                "quote": f"{title}: {value}" if not isinstance(value, bool) else title,
            }
            row = {
                "id": fid("fact", ftype, tag),
                "type": ftype,
                "value": value,
                "confirmed": confirmed,
                "source": source,
                "documentId": doc_id,
                "turnId": None,
            }
        else:
            t = fid("turn", ftype, tag) if rng.random() < 0.3 else turn
            source = {"kind": "statement", "turnId": t, "quote": _quote(rng, ftype, value)}
            row = {
                "id": fid("fact", ftype, tag),
                "type": ftype,
                "value": value,
                "confirmed": confirmed,
                "source": source,
                "documentId": None,
                "turnId": t,
            }
        facts.append(row)

    for ftype, value in values.items():
        if (
            ftype
            in (
                "contact.email",
                "person.marital_status_since",
                "person.previous_names",
                "address.stair",
            )
            and rng.random() < 0.15
        ):
            noise["dropped"].append(ftype)
            continue
        doc = doc_for.get(ftype)
        if doc and rng.random() < 0.6:
            add(ftype, value, document=doc)
            noise["document"].append(ftype)
        else:
            add(ftype, value)

    # IBAN: statement, document only (must stay empty), spaced statement, or unknown.
    mode = rng.choices(["statement", "document", "spaced", "absent"], weights=[55, 20, 10, 15])[0]
    noise["iban"] = mode
    iban = identity["iban"]
    if mode == "statement":
        add("bank.iban", iban)
    elif mode == "document":
        add(
            "bank.iban",
            iban,
            document=doc_for.get("bank.iban") or (fid("doc", "bank"), "Kontoauszug"),
        )
    elif mode == "spaced":
        add("bank.iban", " ".join(iban[k : k + 4] for k in range(0, len(iban), 4)))

    # Unconfirmed extraction that the policy must ignore.
    if rng.random() < 0.25:
        alt = _phone(rng)
        add("contact.phone", alt, confirmed=False, tag="unconfirmed")
        noise["unconfirmed"].append("contact.phone")
    # Two confirmed, different values: ambiguous, the field must stay missing.
    if rng.random() < 0.06:
        ftype = rng.choice(["contact.phone", "address.full", "contact.email"])
        if ftype in values:
            other = (
                _phone(rng)
                if ftype == "contact.phone"
                else (
                    f"{rng.choice(STREETS)} {rng.randint(1, 99)}, {identity['postcode']} "
                    f"{identity['city']}"
                    if ftype == "address.full"
                    else "alt@example.net"
                )
            )
            add(ftype, other, tag="conflict")
            noise["conflict"].append(ftype)
    return identity, facts, noise
