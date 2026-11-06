import json
from pathlib import Path

from corpus.acts import ACTS, resolve
from corpus.parse import paragraph_key, parse_document, reference_meta, search_hits

FIX = Path(__file__).parent / "fixtures"


def test_search_hits_and_reference_meta():
    total, refs = search_hits(json.loads((FIX / "search-asvg.json").read_text()))
    assert total == 1121
    assert len(refs) == 2
    meta = reference_meta(refs[1])
    assert meta["doc_id"] == "NOR40250349"
    assert meta["act"] == "ASVG"
    assert meta["paragraph"] == "§ 30c"
    assert meta["gesetzesnummer"] == "10008147"
    assert meta["norm_type"] == "BG"
    assert meta["valid_from"] == "2020-01-03"
    assert meta["valid_to"] is None
    assert meta["url"].startswith("https://ris.bka.gv.at/eli/bgbl/1955/189/")
    assert meta["xml_url"].endswith("NOR40250349.xml")


def test_parse_document_keeps_only_normative_text():
    doc = parse_document((FIX / "asvg-30c.xml").read_bytes())
    assert doc["title"] == "Wahrnehmung trägerübergreifender Verwaltungsaufgaben"
    text = doc["text"]
    assert text.startswith("§ 30c. (1) Zur Wahrnehmung trägerübergreifender Verwaltungsaufgaben")
    # metadata header and page footer are not part of the text
    assert "Bundesrecht konsolidiert" not in text
    assert "Kundmachungsorgan" not in text
    assert "www.ris.bka.gv.at" not in text
    # <gdash/> becomes a hyphen, list items stay on their own lines
    assert "E-Government-Gesetzes" in text
    assert "\n2. a) die Errichtung" in text or "\n2. a)die Errichtung" in text
    assert "<" not in text and "  " not in text


def test_paragraph_key():
    assert paragraph_key("§ 30c") == "PARA:30c"
    assert paragraph_key("§ 0") == "PARA:0"
    assert paragraph_key("Art. 1") == "ART:1"
    assert paragraph_key("Anl. 2") == "ANL:2"
    assert paragraph_key("Artikel II") == "ART:ii"


def test_resolve_sv_group():
    acts = resolve("sv")
    assert [a.abbr for a in acts] == list(ACTS)
    assert len(acts) == 13
    assert len(resolve("sv-laws")) == 10
    assert resolve("ASVG,FLAG")[1].gesetzesnummer == "10008220"
