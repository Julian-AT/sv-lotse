"""Q-A / Q-B experiment runner (lotse-rl.md §9, table T9).

  uv run python -m quantum.run --backend aer            # instances, baselines, QAOA on Aer
  uv run python -m quantum.run --backend least_busy     # p=1 QAOA on the least busy IBM Heron
  uv run python -m quantum.run --backend ibm_<name>     # ... on a named IBM backend

Results are merged into ml/quantum/results.json. No quantum-advantage claim is made: the point is
a formulation from real administrative data and a reproducible, hashed comparison.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.metadata as md
import json
import subprocess
import time
from pathlib import Path

import numpy as np

from . import classical as C
from . import instances as I
from . import qaoa as A
from . import qubo as Q

OUT = Path(__file__).with_name("results.json")
SHOTS = 4096
P_MAX = 3

# (builder, kwargs). Sizes chosen so the qubit counts sweep 10..30; the last ones are
# classical-only (too large for QAOA simulation).
QA_SPECS = [
    ("care-noe", "care", 2, 1),
    ("care-wien", "care", 2, 1),
    ("care-noe", "care", 3, 1),
    ("care-wien", "care", 3, 1),
    ("care-wien", "care", 4, 1),
    ("care-wien", "care", 5, 1),
    ("care-wien", "care", 4, 2),
    ("care-wien", "care", 7, 5),
    ("care-noe", "care", 4, 5),
]
QB_SPECS = [
    (("care",), False, 3),
    (("care",), False, 6),
    (("geringes-einkommen",), False, None),
    (("care",), False, 9),
    (("care",), False, 11),
    (("care",), False, None),
    (("care", "geringes-einkommen"), False, None),
    (("care", "geringes-einkommen"), True, None),
]
HARDWARE = [
    "qa-care-noe-care-s2",
    "qa-care-wien-care-s2",
    "qa-care-noe-care-s3",
    "qb-care-req-e6",
    "qb-geringes-einkommen-req",
]
QAOA_MAX_QUBITS = 30
# Above 26 qubits Aer uses a matrix product state truncated at this bond dimension
# (approximate sampling; the exact 30-qubit statevector does not fit the workstation).
MPS_BOND = 32


def all_instances() -> list[dict]:
    return [I.build_qa(*s) for s in QA_SPECS] + [I.build_qb(*s) for s in QB_SPECS]


def now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def versions() -> dict:
    out = {}
    for p in (
        "qiskit",
        "qiskit-aer",
        "qiskit-ibm-runtime",
        "qiskit-addon-opt-mapper",
        "ortools",
        "numpy",
        "scipy",
        "pyyaml",
    ):
        try:
            out[p] = md.version(p)
        except md.PackageNotFoundError:
            out[p] = None
    return out


def baselines(inst: dict, q: Q.Qubo) -> dict:
    if inst["kind"] == "Q-A":
        cp = C.cpsat_qa(inst)
        out = {"cpsat": {k: v for k, v in cp.items() if k != "bits"}}
    else:
        cp = C.cpsat_qb(inst)
        out = {
            "cpsat": {k: v for k, v in cp.items() if k not in ("bits", "chosen")},
            "ilp": C.ilp_qb(inst),
            "greedy": C.greedy_qb(inst),
        }
        out["greedy"]["approx_ratio"] = cp["objective"] / out["greedy"]["objective"]
    opt = cp["objective"]
    out["cpsat"]["qubo_energy_of_optimum"] = q.energy(cp["bits"])
    sa = C.simulated_annealing(q, sweeps=1000, restarts=32, seed=0)
    decs = [Q.decode(inst, s) for s in sa.pop("samples")]
    feas = [d for d in decs if d["feasible"]]
    best = Q.decode(inst, sa["bits"])
    out["sa"] = {
        "sweeps": sa["sweeps"],
        "restarts": sa["restarts"],
        "seed": sa["seed"],
        "seconds": sa["seconds"],
        "best_energy": sa["energy"],
        "best_feasible": best["feasible"],
        "best_objective": best["objective"],
        "approx_ratio": opt / best["objective"] if best["feasible"] else None,
        "feasibility_rate": len(feas) / len(decs),
        "p_opt": sum(1 for d in feas if d["objective"] == opt) / len(decs),
    }
    return out, cp


def sample_metrics(inst: dict, q: Q.Qubo, samples, opt: float) -> dict:
    total = feas = hit = 0
    objs, energies = [], []
    best = None
    cache = {}
    for bits, c in samples:
        key = tuple(bits)
        if key not in cache:
            cache[key] = (Q.decode(inst, bits), q.energy(bits))
        d, e = cache[key]
        total += c
        energies.append(e * c)
        if d["feasible"]:
            feas += c
            objs.append(d["objective"] * c)
            hit += c if d["objective"] == opt else 0
            best = d["objective"] if best is None else min(best, d["objective"])
    mean_obj = sum(objs) / feas if feas else None
    return {
        "shots": total,
        "feasibility_rate": feas / total,
        "p_opt": hit / total,
        "best_feasible_objective": best,
        "approx_ratio_best": opt / best if best else None,
        "approx_ratio_mean_feasible": opt / mean_obj if mean_obj else None,
        "mean_qubo_energy": sum(energies) / total,
    }


def exact_metrics(inst: dict, q: Q.Qubo, En: np.ndarray, psi: np.ndarray, opt: float) -> dict:
    pr = np.abs(psi) ** 2
    top = np.argsort(pr)[::-1][:4096]
    feas = sum(pr[i] for i in top if Q.decode(inst, A.bits_of(int(i), q.n))["feasible"])
    return {
        "expected_qubo_energy": float(pr @ En * q.scale),
        "p_ground_state": float(pr[np.isclose(En, En.min())].sum()),
        "feasibility_rate_top4096": float(feas),
    }


def run_aer(insts: list[dict]) -> dict:
    from qiskit import transpile
    from qiskit_aer import AerSimulator

    rows = []
    trained: dict[tuple, dict] = {}
    for inst in insts:
        t0 = time.perf_counter()
        q = Q.build(inst)
        base, cp = baselines(inst, q)
        opt = cp["objective"]
        row = {
            "name": inst["name"],
            "kind": inst["kind"],
            "sha256": inst["sha256"],
            "qubits": q.n,
            "penalties": q.penalties,
            "optimum": opt,
            "baselines": base,
            "qaoa": [],
        }
        if q.n <= 22:
            En = A.energy_vector(q, q.scale)
            g = int(np.argmin(En))
            dg = Q.decode(inst, A.bits_of(g, q.n))
            row["qubo_ground_state"] = {
                "energy": float(En[g] * q.scale),
                **dg,
                "equals_cpsat_optimum": dg["objective"] == opt,
            }
        if q.n <= QAOA_MAX_QUBITS:
            fam = inst["kind"]
            for variant, warm in (("qaoa", None), ("warm-start", cp["bits"])):
                th = A.thetas(warm) if warm is not None else None
                if q.n <= A.MAX_EXACT:
                    params = A.train(En, q.n, P_MAX, th, maxiter=150)
                    trained[(fam, variant)] = params
                    source = "trained (exact statevector, COBYLA)"
                else:
                    params = trained.get((fam, variant))
                    source = "transferred from the largest trained instance of the family"
                if not params:
                    continue
                for p in range(1, P_MAX + 1):
                    gam, bet, _ = params[p]
                    qc = A.circuit(q, gam, bet, warm)
                    method = "statevector" if q.n <= 26 else "matrix_product_state"
                    opts = (
                        {} if q.n <= 26 else {"matrix_product_state_max_bond_dimension": MPS_BOND}
                    )
                    sim = AerSimulator(method=method, seed_simulator=7, **opts)
                    tq = transpile(qc, sim, optimization_level=1, seed_transpiler=7)
                    ts = time.perf_counter()
                    counts = sim.run(tq, shots=SHOTS).result().get_counts()
                    m = sample_metrics(inst, q, A.counts_to_bits(counts, q.n), opt)
                    entry = {
                        "variant": variant,
                        "p": p,
                        "gammas": gam,
                        "betas": bet,
                        "params": source,
                        "backend": f"aer_simulator/{method}"
                        + (f"(max_bond={MPS_BOND})" if q.n > 26 else ""),
                        "transpiled_depth": tq.depth(),
                        "two_qubit_gates": int(
                            tq.count_ops().get("rzz", 0) + tq.count_ops().get("cx", 0)
                        ),
                        "sim_seconds": time.perf_counter() - ts,
                        **m,
                    }
                    if q.n <= A.MAX_EXACT:
                        psi = A.statevector(En, q.n, gam, bet, th)
                        entry["exact"] = exact_metrics(inst, q, En, psi, opt)
                    row["qaoa"].append(entry)
                    print(
                        f"  {inst['name']} {variant} p={p} ratio_best="
                        f"{m['approx_ratio_best']} feas={m['feasibility_rate']:.3f}",
                        flush=True,
                    )
        row["seconds"] = time.perf_counter() - t0
        rows.append(row)
        print(f"{inst['name']}: {q.n} qubits, opt {opt}, {row['seconds']:.1f}s", flush=True)
        _write({"aer": {"backend": "aer", "shots": SHOTS, "partial": True, "runs": rows}})
    return {"backend": "aer", "shots": SHOTS, "finished_at": now(), "runs": rows}


def run_ibm(insts: list[dict], backend_name: str, wait_until: str, env_file: str) -> dict:
    import os

    from dotenv import load_dotenv

    load_dotenv(env_file)  # the token is read into the process only, never printed or stored
    token = os.environ.get("IBM_QUANTUM_TOKEN")
    if not token:
        return {"status": "not run", "reason": "IBM_QUANTUM_TOKEN not set"}
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    kw = {"channel": "ibm_quantum_platform", "token": token}
    if os.environ.get("IBM_QUANTUM_INSTANCE"):
        kw["instance"] = os.environ["IBM_QUANTUM_INSTANCE"]
    try:
        service = QiskitRuntimeService(**kw)
        if backend_name == "least_busy":
            cands = [
                b
                for b in service.backends(operational=True, simulator=False)
                if (getattr(b, "processor_type", None) or {}).get("family") == "Heron"
            ]
            backend = min(cands, key=lambda b: b.status().pending_jobs)
        else:
            backend = service.backend(backend_name)
    except Exception as e:  # noqa: BLE001
        return {"status": "not run", "reason": f"service/backend unavailable: {type(e).__name__}"}

    pm = generate_preset_pass_manager(optimization_level=3, backend=backend, seed_transpiler=7)
    pubs, meta = [], []
    for inst in insts:
        if not any(inst["name"].startswith(h) for h in HARDWARE):
            continue
        q = Q.build(inst)
        cp = C.cpsat_qa(inst) if inst["kind"] == "Q-A" else C.cpsat_qb(inst)
        En = A.energy_vector(q, q.scale)
        for variant, warm in (("qaoa", None), ("warm-start", cp["bits"])):
            th = A.thetas(warm) if warm is not None else None
            gam, bet, _ = A.train(En, q.n, 1, th, maxiter=150)[1]
            tq = pm.run(A.circuit(q, gam, bet, warm))
            ops = tq.count_ops()
            pubs.append(tq)
            meta.append(
                {
                    "name": inst["name"],
                    "sha256": inst["sha256"],
                    "kind": inst["kind"],
                    "qubits": q.n,
                    "variant": variant,
                    "p": 1,
                    "gammas": gam,
                    "betas": bet,
                    "optimum": cp["objective"],
                    "transpiled_depth": tq.depth(),
                    "two_qubit_gates": int(
                        sum(v for k, v in ops.items() if k in ("cz", "ecr", "cx"))
                    ),
                    "physical_qubits": tq.num_qubits,
                }
            )
    sampler = SamplerV2(mode=backend)
    job = sampler.run(pubs, shots=SHOTS)
    out = {
        "status": "submitted",
        "backend": backend.name,
        "job_id": job.job_id(),
        "git_sha": git_sha(),
        "submitted_at": now(),
        "shots": SHOTS,
        "circuits": meta,
        "processor_family": "Heron",
    }
    print(f"submitted job {job.job_id()} to {backend.name}", flush=True)
    _write({"hardware": out})
    deadline = dt.datetime.fromisoformat(wait_until)
    while dt.datetime.now(deadline.tzinfo) < deadline:
        st = job.status()
        st = getattr(st, "name", str(st))
        if st in ("DONE", "ERROR", "CANCELLED"):
            break
        time.sleep(20)
    st = job.status()
    st = getattr(st, "name", str(st))
    out["final_status"] = st
    if st != "DONE":
        out["status"] = "not run"
        out["reason"] = f"job {st} at {now()}, queue did not return before {wait_until}"
        return out
    res = job.result()
    by_name = {i["name"]: i for i in insts}
    for k, m in enumerate(meta):
        counts = res[k].data.meas.get_counts()
        inst = by_name[m["name"]]
        q = Q.build(inst)
        m.update(sample_metrics(inst, q, A.counts_to_bits(counts, q.n), m["optimum"]))
    out["status"] = "done"
    out["finished_at"] = now()
    return out


def _write(update: dict) -> None:
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    data.update(update)
    data["git_sha"] = git_sha()
    data["package_versions"] = versions()
    data["updated_at"] = now()
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False, default=float) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="aer")
    ap.add_argument("--wait-until", default="2026-11-06T06:05:00+01:00")
    ap.add_argument("--env-file", default=str(Path(__file__).resolve().parents[2] / ".env.local"))
    args = ap.parse_args()
    started = now()
    insts = all_instances()
    summary = [
        {"name": i["name"], "kind": i["kind"], "sha256": i["sha256"], "qubits": Q.build(i).n}
        for i in insts
    ]
    meta = {
        "instances": summary,
        "notes": {
            "framing": "No quantum-advantage claim. Classical solvers are exact or near-exact on "
            "every instance; QAOA is reported for the formulation and hardware study.",
            "approx_ratio": "optimum / objective of a feasible sample (minimisation, 1 = optimal)",
            "q_a": I.__doc__,
            "qubo": Q.__doc__,
            "qaoa": A.__doc__,
        },
    }
    if args.backend == "aer":
        res = run_aer(insts)
        res["started_at"] = started
        _write({**meta, "aer": res})
    else:
        hw = run_ibm(insts, args.backend, args.wait_until, args.env_file)
        hw["started_at"] = started
        _write({**meta, "hardware": hw})
        print(json.dumps({k: v for k, v in hw.items() if k != "circuits"}, indent=1))


if __name__ == "__main__":
    main()
