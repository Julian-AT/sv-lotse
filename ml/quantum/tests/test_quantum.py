import itertools

import numpy as np
import pytest

pytest.importorskip("ortools")
pytest.importorskip("qiskit")

from quantum import classical as C  # noqa: E402
from quantum import instances as I  # noqa: E402
from quantum import knowledge as kb  # noqa: E402
from quantum import qaoa as A  # noqa: E402
from quantum import qubo as Q  # noqa: E402

QA = [("care-wien", "care", 2, 1), ("care-noe", "care", 3, 1), ("care-wien", "care", 4, 2)]
QB = [
    (("care",), False, 6),
    (("geringes-einkommen",), False, None),
    (("care", "geringes-einkommen"), True, None),
]


@pytest.mark.parametrize("spec", QA)
def test_qa_cpsat_optimum_energy_equals_objective(spec):
    inst = I.build_qa(*spec)
    q = Q.build(inst)
    cp = C.cpsat_qa(inst)
    assert cp["status"] == "OPTIMAL"
    assert q.energy(cp["bits"]) == pytest.approx(cp["objective"])
    d = Q.decode(inst, cp["bits"])
    assert d["feasible"] and d["objective"] == pytest.approx(cp["objective"])


@pytest.mark.parametrize("spec", QB)
def test_qb_cpsat_optimum_energy_equals_objective(spec):
    inst = I.build_qb(*spec)
    q = Q.build(inst)
    cp = C.cpsat_qb(inst)
    assert q.energy(cp["bits"]) == pytest.approx(q.penalties["B"] * cp["objective"])
    assert C.ilp_qb(inst)["objective"] == cp["objective"]
    assert C.greedy_qb(inst)["objective"] >= cp["objective"]


@pytest.mark.parametrize(
    "build", [lambda: I.build_qa("care-noe", "care", 2, 1), lambda: I.build_qb(("care",), False, 3)]
)
def test_ground_state_is_feasible_and_optimal(build):
    inst = build()
    q = Q.build(inst)
    En = A.energy_vector(q)
    g = int(np.argmin(En))
    d = Q.decode(inst, A.bits_of(g, q.n))
    cp = C.cpsat_qa(inst) if inst["kind"] == "Q-A" else C.cpsat_qb(inst)
    assert d["feasible"] and d["objective"] == cp["objective"]
    # brute force agrees with the vectorised energies
    for bits in itertools.islice(itertools.product([0, 1], repeat=q.n), 0, 2**q.n, 97):
        idx = sum(b << k for k, b in enumerate(bits))
        assert En[idx] == pytest.approx(q.energy(bits))


def test_decoding_rejects_infeasible():
    inst = I.build_qa("care-wien", "care", 2, 1)
    n = len(inst["variables"])
    assert not Q.decode(inst, [0] * n)["feasible"]
    assert not Q.decode(inst, [1] * n)["feasible"]
    first = [k for k, v in enumerate(inst["variables"]) if v["step"] == 0][0]
    clash = [
        k
        for k, v in enumerate(inst["variables"])
        if v["step"] == 1
        and v["start"] == inst["variables"][first]["start"]
        and v["day"] == inst["variables"][first]["day"]
    ][0]
    x = [0] * n
    x[first] = x[clash] = 1
    d = Q.decode(inst, x)
    assert d["one_hot"] and d["overlap"] and not d["feasible"]
    qb_inst = I.build_qb(("care",), False, 6)
    assert not Q.decode(qb_inst, [0] * Q.build(qb_inst).n)["feasible"]


def test_instances_are_deterministic_and_from_the_catalog():
    a, b = I.build_qa("care-wien", "care", 3, 1), I.build_qa("care-wien", "care", 3, 1)
    assert a["sha256"] == b["sha256"] == I.canonical_hash(a)
    assert I.build_qb(("care",))["sha256"] == I.build_qb(("care",))["sha256"]
    for s in a["steps"]:
        assert s["benefit"] in kb.catalog()
        assert s["place"] in kb.places()


def test_opening_hours_parser():
    h = kb.parse_opening_hours("Mo–Fr 8:00–15:00 Uhr; Do 8:00–17:30 Uhr")
    assert h[0] == [(480, 900)] and h[3] == [(480, 1050)] and 5 not in h
    h = kb.parse_opening_hours(
        {
            "notes": "Montag bis Mittwoch und Freitag von 7:00 bis 15:00 Uhr\n"
            "Donnerstag von 7:00 bis 18:00 Uhr"
        }
    )
    assert h[1] == [(420, 900)] and h[3] == [(420, 1080)] and h[4] == [(420, 900)]


def test_circuit_matches_numpy_statevector():
    from qiskit.quantum_info import Statevector

    inst = I.build_qb(("care",), False, 3)
    q = Q.build(inst)
    En = A.energy_vector(q, q.scale)
    warm = C.cpsat_qb(inst)["bits"]
    for wb in (None, warm):
        th = None if wb is None else A.thetas(wb)
        psi = A.statevector(En, q.n, [0.3, 0.2], [0.4, 0.1], th)
        sv = Statevector(A.circuit(q, [0.3, 0.2], [0.4, 0.1], wb, measure=False)).data
        assert abs(np.vdot(psi, sv)) == pytest.approx(1.0, abs=1e-9)
