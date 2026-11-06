"""QAOA and warm-start QAOA: parameter training on an exact numpy statevector (n <= 20),
Qiskit circuits for sampling on Aer or IBM hardware.

Energies are divided by the largest absolute QUBO coefficient before building the circuit so
that angles are comparable across instances. Plain QAOA starts in |+>^n with the RX mixer.
Warm-start QAOA (Egger, Marecek, Woerner 2021) starts in prod_k RY(theta_k)|0> with
sin^2(theta_k/2) = c_k, c_k = eps or 1 - eps from the CP-SAT bits (eps = 0.25), and uses the
mixer RY(theta_k) RZ(-2 beta) RY(-theta_k). Warm-starting from the exact optimum is the most
favourable case for QAOA by construction; we report it as such, not as an independent solver.
"""

from __future__ import annotations

import numpy as np
from qiskit import QuantumCircuit
from scipy.optimize import minimize

from .qubo import Qubo

EPS = 0.25
MAX_EXACT = 20


def energy_vector(q: Qubo, scale: float = 1.0) -> np.ndarray:
    n = q.n
    idx = np.arange(2**n, dtype=np.int64)
    bits = [((idx >> k) & 1).astype(bool) for k in range(n)]
    E = np.full(2**n, q.offset, dtype=float)
    for k in range(n):
        if q.Q[k, k]:
            E[bits[k]] += q.Q[k, k]
        for w in range(k + 1, n):
            if q.Q[k, w]:
                E[bits[k] & bits[w]] += q.Q[k, w]
    return E / scale


def bits_of(index: int, n: int) -> list[int]:
    return [(index >> k) & 1 for k in range(n)]


def _ry(a):
    c, s = np.cos(a / 2), np.sin(a / 2)
    return np.array([[c, -s], [s, c]], dtype=complex)


def _rz(a):
    return np.diag([np.exp(-0.5j * a), np.exp(0.5j * a)])


def _rx(a):
    c, s = np.cos(a / 2), np.sin(a / 2)
    return np.array([[c, -1j * s], [-1j * s, c]])


def _apply_1q(psi, n, k, U):
    v = psi.reshape(2 ** (n - k - 1), 2, 2**k)
    return np.einsum("ab,ibj->iaj", U, v).reshape(-1)


def thetas(warm_bits) -> np.ndarray:
    c = np.where(np.asarray(warm_bits) > 0.5, 1 - EPS, EPS)
    return 2 * np.arcsin(np.sqrt(c))


def statevector(En: np.ndarray, n: int, gammas, betas, warm_theta=None) -> np.ndarray:
    if warm_theta is None:
        psi = np.full(2**n, 2 ** (-n / 2), dtype=complex)
    else:
        psi = np.zeros(2**n, dtype=complex)
        psi[0] = 1
        for k in range(n):
            psi = _apply_1q(psi, n, k, _ry(warm_theta[k]))
    for g, b in zip(gammas, betas, strict=True):
        psi = psi * np.exp(-1j * g * En)
        for k in range(n):
            U = (
                _rx(2 * b)
                if warm_theta is None
                else (_ry(warm_theta[k]) @ _rz(-2 * b) @ _ry(-warm_theta[k]))
            )
            psi = _apply_1q(psi, n, k, U)
    return psi


def train(En: np.ndarray, n: int, p_max: int = 3, warm_theta=None, maxiter: int = 200):
    """Grid search for p = 1, then layer-wise INTERP initialisation (Zhou et al. 2020) and
    COBYLA. Returns {p: (gammas, betas, expected normalised energy)}."""

    def f(params, p):
        psi = statevector(En, n, params[:p], params[p:], warm_theta)
        return float(np.dot(np.abs(psi) ** 2, En))

    out = {}
    best = None
    for g in np.linspace(0.02, 1.2, 16):
        for b in np.linspace(0.05, np.pi / 2, 10):
            val = f(np.array([g, b]), 1)
            if best is None or val < best[0]:
                best = (val, np.array([g, b]))
    params = best[1]
    for p in range(1, p_max + 1):
        if p > 1:
            g, b = params[: p - 1], params[p - 1 :]

            def interp(v, p=p):
                v = np.concatenate([[0.0], v, [0.0]])
                return np.array(
                    [((i - 1) * v[i - 1] + (p - i) * v[i]) / (p - 1) for i in range(1, p + 1)]
                )

            params = np.concatenate([interp(g), interp(b)])
        res = minimize(
            f, params, args=(p,), method="COBYLA", options={"maxiter": maxiter, "rhobeg": 0.1}
        )
        params = res.x
        out[p] = (params[:p].tolist(), params[p:].tolist(), float(res.fun))
    return out


def circuit(q: Qubo, gammas, betas, warm_bits=None, measure: bool = True) -> QuantumCircuit:
    n = q.n
    h, J, _ = q.ising(q.scale)
    qc = QuantumCircuit(n)
    th = thetas(warm_bits) if warm_bits is not None else None
    if th is None:
        qc.h(range(n))
    else:
        for k in range(n):
            qc.ry(th[k], k)
    for g, b in zip(gammas, betas, strict=True):
        for (k, w), j in J.items():
            qc.rzz(2 * g * j, k, w)
        for k in range(n):
            if h[k]:
                qc.rz(2 * g * h[k], k)
        for k in range(n):
            if th is None:
                qc.rx(2 * b, k)
            else:
                qc.ry(-th[k], k)
                qc.rz(-2 * b, k)
                qc.ry(th[k], k)
    if measure:
        qc.measure_all()
    return qc


def counts_to_bits(counts: dict[str, int], n: int):
    """Qiskit bitstrings are little-endian (qubit 0 rightmost)."""
    for s, c in counts.items():
        s = s.replace(" ", "")[-n:]
        yield [int(ch) for ch in reversed(s)], c
