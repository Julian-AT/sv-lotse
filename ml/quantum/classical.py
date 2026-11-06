"""Classical baselines: CP-SAT (exact) for Q-A, greedy/ILP/CP-SAT for Q-B, simulated annealing
on the QUBO for both."""

from __future__ import annotations

import time

import numpy as np
from ortools.linear_solver import pywraplp
from ortools.sat.python import cp_model

from . import qubo as qb


def cpsat_qa(inst: dict, time_limit: float = 60.0) -> dict:
    v = inst["variables"]
    overlap, consec = qb.qa_pairs(inst)
    m = cp_model.CpModel()
    x = [m.NewBoolVar(f"x{k}") for k in range(len(v))]
    for i in range(len(inst["steps"])):
        m.AddExactlyOne([x[k] for k, a in enumerate(v) if a["step"] == i])
    for k, w in overlap:
        m.AddBoolOr([x[k].Not(), x[w].Not()])
    terms = [a["lateness"] * x[k] for k, a in enumerate(v)]
    for k, w, tau in consec:
        if tau:
            y = m.NewBoolVar(f"y{k}_{w}")
            m.AddBoolOr([x[k].Not(), x[w].Not(), y])
            terms.append(tau * y)
    m.Minimize(sum(terms))
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = time_limit
    s.parameters.num_workers = 8
    s.parameters.random_seed = 0
    t0 = time.perf_counter()
    st = s.Solve(m)
    dt = time.perf_counter() - t0
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": s.StatusName(st), "seconds": dt}
    bits = [int(s.Value(xx)) for xx in x]
    return {
        "status": s.StatusName(st),
        "objective": float(s.ObjectiveValue()),
        "bits": bits,
        "seconds": dt,
    }


def cpsat_qb(inst: dict, time_limit: float = 60.0) -> dict:
    sets, n_el = inst["sets"], len(inst["elements"])
    m = cp_model.CpModel()
    x = [m.NewBoolVar(s["id"]) for s in sets]
    for a in range(n_el):
        m.AddBoolOr([x[i] for i, s in enumerate(sets) if a in s["elements"]])
    m.Minimize(sum(x))
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = time_limit
    s.parameters.num_workers = 8
    s.parameters.random_seed = 0
    t0 = time.perf_counter()
    st = s.Solve(m)
    chosen = [i for i in range(len(sets)) if s.Value(x[i])]
    return {
        "status": s.StatusName(st),
        "objective": float(s.ObjectiveValue()),
        "chosen": chosen,
        "bits": [int(b) for b in qb.qb_complete(inst, chosen)],
        "seconds": time.perf_counter() - t0,
    }


def ilp_qb(inst: dict) -> dict:
    sets, n_el = inst["sets"], len(inst["elements"])
    solver = pywraplp.Solver.CreateSolver("SCIP") or pywraplp.Solver.CreateSolver("CBC")
    x = [solver.BoolVar(s["id"]) for s in sets]
    for a in range(n_el):
        solver.Add(sum(x[i] for i, s in enumerate(sets) if a in s["elements"]) >= 1)
    solver.Minimize(sum(x))
    t0 = time.perf_counter()
    st = solver.Solve()
    chosen = [i for i in range(len(sets)) if x[i].solution_value() > 0.5]
    return {
        "solver": solver.SolverVersion(),
        "optimal": st == pywraplp.Solver.OPTIMAL,
        "objective": float(len(chosen)),
        "chosen": [sets[i]["id"] for i in chosen],
        "seconds": time.perf_counter() - t0,
    }


def greedy_qb(inst: dict) -> dict:
    sets = inst["sets"]
    left = set(range(len(inst["elements"])))
    chosen = []
    while left:
        i = max(range(len(sets)), key=lambda i: (len(left & set(sets[i]["elements"])), -i))
        chosen.append(i)
        left -= set(sets[i]["elements"])
    return {"objective": float(len(chosen)), "chosen": [sets[i]["id"] for i in chosen]}


def simulated_annealing(
    q: qb.Qubo,
    sweeps: int = 1000,
    restarts: int = 32,
    seed: int = 0,
    t_hot: float | None = None,
    t_cold: float = 0.05,
) -> dict:
    """Single-flip Metropolis annealing on the QUBO, geometric schedule, vectorised over
    restarts. Returns the best bit vector found and its energy."""
    rng = np.random.default_rng(seed)
    n = q.n
    W = q.Q + q.Q.T
    lin = np.diag(q.Q).copy()
    np.fill_diagonal(W, 0.0)
    if t_hot is None:
        t_hot = float(np.max(np.abs(lin) + np.abs(W).sum(1)))
    temps = t_hot * (t_cold / t_hot) ** (np.arange(sweeps) / max(1, sweeps - 1))
    x = rng.integers(0, 2, size=(restarts, n)).astype(float)
    field = x @ W
    t0 = time.perf_counter()
    for T in temps:
        for k in rng.permutation(n):
            dE = (1 - 2 * x[:, k]) * (lin[k] + field[:, k])
            acc = (dE <= 0) | (rng.random(restarts) < np.exp(-np.clip(dE, 0, None) / T))
            if acc.any():
                delta = np.where(acc, 1 - 2 * x[:, k], 0.0)
                x[:, k] += delta
                field += np.outer(delta, W[k])
    energies = np.einsum("ri,ij,rj->r", x, q.Q, x) + q.offset
    best = int(np.argmin(energies))
    return {
        "bits": x[best].astype(int).tolist(),
        "energy": float(energies[best]),
        "energies": energies.tolist(),
        "samples": x.astype(int),
        "sweeps": sweeps,
        "restarts": restarts,
        "seed": seed,
        "seconds": time.perf_counter() - t0,
    }
