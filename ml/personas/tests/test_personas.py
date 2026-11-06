from personas.generate import (
    HELDOUT_AREA,
    _style,
    bundle_names,
    make_row,
    render_persona,
    sample_card,
    split_counts,
    split_of,
)
from personas.goals import GOALS, TARGETS
from personas.render import HELDOUT_STYLES
from personas.vocab import load_vocab

VOCAB = load_vocab(use_server=False)
N = 5500
SEED = 7


def test_split_counts_match_plan():
    assert split_counts(55000) == {
        "train": 50000,
        "val": 2000,
        "test": 2000,
        "heldout_family": 1000,
    }


def test_same_seed_same_persona():
    for i in (0, 17, 5000, 5450):
        a, b = sample_card(SEED, i, N, VOCAB), sample_card(SEED, i, N, VOCAB)
        assert a == b
        assert render_persona(a, SEED, VOCAB) == render_persona(b, SEED, VOCAB)
        assert make_row(SEED, i, N, VOCAB) == make_row(SEED, i, N, VOCAB)


def test_different_seed_differs():
    assert any(
        sample_card(SEED, i, N, VOCAB) != sample_card(SEED + 1, i, N, VOCAB) for i in range(20)
    )


def test_persona_independent_of_other_indices():
    # Seeded per index: generating index i does not depend on generating i-1 first.
    assert sample_card(SEED, 300, N, VOCAB) == sample_card(SEED, 300, N, VOCAB, attempt=0)
    assert sample_card(SEED, 300, N, VOCAB, attempt=1) != sample_card(SEED, 300, N, VOCAB)


def test_split_isolation():
    seen = {}
    for i in range(N):
        s = split_of(i, N)
        card = sample_card(SEED, i, N, VOCAB)
        assert card["split"] == s
        assert card["id"] not in seen
        seen[card["id"]] = s
    counts = {s: list(seen.values()).count(s) for s in set(seen.values())}
    assert counts == split_counts(N)


def test_heldout_family_only_in_heldout_split():
    held = {g.id for g in GOALS if HELDOUT_AREA in VOCAB.bundle_areas(TARGETS[g.id][1])}
    assert held and held != {g.id for g in GOALS}
    for i in range(N):
        card = sample_card(SEED, i, N, VOCAB)
        bundle_areas = VOCAB.bundle_areas(card["_life_situation"])
        if card["split"] == "heldout_family":
            assert card["_scenario"] in held and HELDOUT_AREA in bundle_areas
        else:
            assert card["_scenario"] not in held and HELDOUT_AREA not in bundle_areas


def test_heldout_styles_only_in_test():
    styles = {}
    for i in range(N):
        styles.setdefault(split_of(i, N), set()).add(_style(SEED, i, split_of(i, N)))
    for split, st in styles.items():
        if split == "test":
            assert st & set(HELDOUT_STYLES)
        else:
            assert not st & set(HELDOUT_STYLES)


def test_no_bundle_name_in_text():
    for i in range(0, N, 7):
        row = make_row(SEED, i, N, VOCAB)
        assert row is not None
        low = row["situation_text"].lower()
        assert not any(name in low for name in bundle_names(VOCAB, row["life_situation"]))
