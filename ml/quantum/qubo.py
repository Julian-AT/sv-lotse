"""QUBO formulations (lotse-rl.md §9) and bitstring decoding.

A QUBO is an upper-triangular matrix Q (diagonal = linear terms) plus an offset;
E(x) = sum_{k<=l} Q[k, w] x_k x_l + offset for x in {0,1}^n.

Q-A (case scheduling), x_{i,t} = 1 if step i starts in allowed slot t:
  H = A sum_i (sum_t x_{i,t} - 1)^2
    + B sum_{overlapping (i,t),(j,u), i != j} x_{i,t} x_{j,u}
    + sum_{i,t} lateness_i(t) x_{i,t}
    + C sum_{consecutive (i,t)->(j,u)} tau(i,j) x_{i,t} x_{j,u}
  with C = 1 (travel minutes and lateness share one unit) and
  A = B = 1 + max_k (lateness_k + sum_l C tau_kl [k,w consecutive]), i.e. larger than anything a
  single variable can gain on the objective terms. For every instance we enumerate (n <= 20) or
  anneal and check that the QUBO ground state is feasible and equals the CP-SAT optimum.
  "Overlapping" = same day and intersecting [start, end); "consecutive" = same day, (j,u) starts
  at or after the end of (i,t) and no grid start lies in between.

Q-B (minimum set cover, Lucas 2014 §5.1), x_i = 1 if set i is used, y_{a,m} = 1 if element a is
covered exactly m times (m = 1..M_a, M_a = number of sets containing a):
  H = A sum_a (1 - sum_m y_{a,m})^2 + A sum_a (sum_m m y_{a,m} - sum_{i: a in V_i} x_i)^2
    + B sum_i x_i,   with B = 1 and A = 2 (Lucas requires 0 < B < A).
  Decoding reads only the set bits; a sample is feasible if the chosen sets cover every element.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Qubo:
    n: int
    Q: np.ndarray
    offset: float = 0.0
    labels: list[str] = field(default_factory=list)
    penalties: dict = field(default_factory=dict)

    def energy(self, x) -> float:
        x = np.asarray(x, dtype=float)
        return float(x @ self.Q @ x + self.offset)

    def add(self, k: int, w: int, v: float) -> None:
        if k > w:
            k, w = w, k
        self.Q[k, w] += v

    def add_square(self, terms: list[tuple[int, float]], const: float, weight: float) -> None:
        """weight * (const + sum c_k x_k)^2 using x^2 = x."""
        self.offset += weight * const * const
        for a, (k, ck) in enumerate(terms):
            self.add(k, k, weight * (ck * ck + 2 * const * ck))
            for w, cl in terms[a + 1 :]:
                self.add(k, w, weight * 2 * ck * cl)

    def ising(self, scale: float = 1.0):
        """Return (h, J, const) with x = (1 - z)/2, divided by scale."""
        Q = self.Q / scale
        n = self.n
        h = np.zeros(n)
        J = {}
        const = self.offset / scale
        for k in range(n):
            a = Q[k, k]
            h[k] += -a / 2
            const += a / 2
            for w in range(k + 1, n):
                b = Q[k, w]
                if b == 0:
                    continue
                const += b / 4
                h[k] -= b / 4
                h[w] -= b / 4
                J[(k, w)] = b / 4
        return h, J, const

    @property
    def scale(self) -> float:
        return float(np.max(np.abs(self.Q)))


# ---------------------------------------------------------------- Q-A -----------------------


def qa_pairs(inst: dict):
    """Overlap pairs and consecutive (ordered) pairs with travel minutes."""
    v = inst["variables"]
    grid = inst["grid"]
    overlap, consec = [], []
    for k, a in enumerate(v):
        for w, b in enumerate(v):
            if a["step"] == b["step"] or a["day"] != b["day"]:
                continue
            if k < w and a["start"] < b["end"] and b["start"] < a["end"]:
                overlap.append((k, w))
            elif b["start"] >= a["end"] and not any(a["end"] <= g < b["start"] for g in grid):
                consec.append((k, w, inst["travel_min"][a["step"]][b["step"]]))
    return overlap, consec


def qa_qubo(inst: dict, C: float = 1.0) -> Qubo:
    v = inst["variables"]
    n = len(v)
    overlap, consec = qa_pairs(inst)
    gain = [float(x["lateness"]) for x in v]
    for k, w, tau in consec:
        gain[k] += C * tau
        gain[w] += C * tau
    A = B = 1.0 + max(gain)
    q = Qubo(
        n,
        np.zeros((n, n)),
        labels=[f"x[{x['step']},d{x['day']},{x['start']}]" for x in v],
        penalties={"A_one_hot": A, "B_overlap": B, "C_travel": C},
    )
    for i in range(len(inst["steps"])):
        q.add_square([(k, 1.0) for k, x in enumerate(v) if x["step"] == i], -1.0, A)
    for k, w in overlap:
        q.add(k, w, B)
    for k, x in enumerate(v):
        q.add(k, k, float(x["lateness"]))
    for k, w, tau in consec:
        if tau:
            q.add(k, w, C * tau)
    return q


def qa_objective(inst: dict, x) -> float:
    v = inst["variables"]
    _, consec = qa_pairs(inst)
    obj = sum(v[k]["lateness"] for k in range(len(v)) if x[k])
    obj += sum(tau for k, w, tau in consec if x[k] and x[w])
    return float(obj)


def qa_decode(inst: dict, x) -> dict:
    v = inst["variables"]
    overlap, _ = qa_pairs(inst)
    counts = [0] * len(inst["steps"])
    for k, b in enumerate(x):
        if b:
            counts[v[k]["step"]] += 1
    one_hot = all(c == 1 for c in counts)
    clash = any(x[k] and x[w] for k, w in overlap)
    feasible = one_hot and not clash
    return {
        "feasible": feasible,
        "objective": qa_objective(inst, x) if feasible else None,
        "one_hot": one_hot,
        "overlap": clash,
    }


# ---------------------------------------------------------------- Q-B -----------------------


def qb_layout(inst: dict):
    sets = inst["sets"]
    n_el = len(inst["elements"])
    covering = [[i for i, s in enumerate(sets) if a in s["elements"]] for a in range(n_el)]
    slack = {}
    k = len(sets)
    for a in range(n_el):
        for m in range(1, len(covering[a]) + 1):
            slack[(a, m)] = k
            k += 1
    return covering, slack, k


def qb_qubo(inst: dict, A: float = 2.0, B: float = 1.0) -> Qubo:
    covering, slack, n = qb_layout(inst)
    labels = [f"set[{s['id']}]" for s in inst["sets"]] + [f"y[{a},{m}]" for (a, m) in slack]
    q = Qubo(n, np.zeros((n, n)), labels=labels, penalties={"A": A, "B": B})
    for a, cov in enumerate(covering):
        ys = [(slack[(a, m)], 1.0) for m in range(1, len(cov) + 1)]
        q.add_square(ys, -1.0, A)
        terms = [(slack[(a, m)], float(m)) for m in range(1, len(cov) + 1)]
        terms += [(i, -1.0) for i in cov]
        q.add_square(terms, 0.0, A)
    for i in range(len(inst["sets"])):
        q.add(i, i, B)
    return q


def qb_complete(inst: dict, chosen: list[int]) -> np.ndarray:
    """Full bit vector (sets + consistent slack bits) for a chosen family of sets."""
    covering, slack, n = qb_layout(inst)
    x = np.zeros(n)
    for i in chosen:
        x[i] = 1
    for a, cov in enumerate(covering):
        m = sum(1 for i in cov if i in chosen)
        if m:
            x[slack[(a, m)]] = 1
    return x


def qb_decode(inst: dict, x) -> dict:
    sets = inst["sets"]
    chosen = [i for i in range(len(sets)) if x[i]]
    covered = set()
    for i in chosen:
        covered.update(sets[i]["elements"])
    feasible = len(covered) == len(inst["elements"])
    return {
        "feasible": feasible,
        "objective": float(len(chosen)) if feasible else None,
        "chosen": [sets[i]["id"] for i in chosen],
    }


def build(inst: dict) -> Qubo:
    return qa_qubo(inst) if inst["kind"] == "Q-A" else qb_qubo(inst)


def decode(inst: dict, x) -> dict:
    return qa_decode(inst, x) if inst["kind"] == "Q-A" else qb_decode(inst, x)
