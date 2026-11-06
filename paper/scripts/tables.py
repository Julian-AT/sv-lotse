#!/usr/bin/env python3
"""Generate the LaTeX tables of the Lotse-RL preprint from result files.

Standard library only. Inputs:
  ml/results/*.json            research runs (personas, corpus, gym self-test, SFT, ...)
  ml/quantum/results.json      quantum study (T9)
  docs/evals/results.md        product evaluation suites (measured by the product, not this lane)
  packages/knowledge/          catalog, processes, offices, forms (world statistics)

Every table without an input file is written with a single "not run" row. No number in the
paper is typed by hand: everything below is read from those files.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

PAPER = Path(__file__).resolve().parents[1]
ROOT = PAPER.parent
OUT = PAPER / "generated"
RESULTS = ROOT / "ml" / "results"
QUANTUM = ROOT / "ml" / "quantum" / "results.json"
EVALS_MD = ROOT / "docs" / "evals" / "results.md"
KNOWLEDGE = ROOT / "packages" / "knowledge"

MAX_ROWS = 40
MAX_COLS = 12


# ---------------------------------------------------------------- helpers


def tex(value: object) -> str:
    """Escape a value for LaTeX text mode."""
    s = str(value)
    repl = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
        "<": r"\textless{}",
        ">": r"\textgreater{}",
        "–": "--",
        "—": "---",
        "≥": r"$\geq$",
        "≤": r"$\leq$",
        "×": r"$\times$",
        "→": r"$\rightarrow$",
    }
    return "".join(repl.get(ch, ch) for ch in s)


def fmt(value: object) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, int):
        return f"{value:,}".replace(",", "{,}")
    if isinstance(value, float):
        if value != value:  # NaN
            return "n/a"
        return f"{value:.4g}"
    if value is None:
        return "--"
    s = re.sub(r"/Users/[^ ]*?/sv-lotse[^/ ]*/", "", str(value))  # no local home paths in the paper
    if re.fullmatch(r"[0-9a-f]{32,}", s):
        return tex(s[:12]) + r"\ldots"
    if len(s) > 48:
        s = s[:45] + "..."
    return tex(s)


def key_label(path: str) -> str:
    return tex(path.replace(".", " / "))


def sha12(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def flatten(obj: object, prefix: str = "") -> list[tuple[str, object]]:
    """Scalar leaves of a JSON object, in document order. Lists of scalars are joined."""
    rows: list[tuple[str, object]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, (dict, list)):
                rows.extend(flatten(v, p))
            else:
                rows.append((p, v))
    elif isinstance(obj, list):
        if all(not isinstance(x, (dict, list)) for x in obj):
            if obj:
                rows.append((prefix, ", ".join(str(x) for x in obj[:8]) + (" ..." if len(obj) > 8 else "")))
        else:
            for i, v in enumerate(obj[:6]):
                rows.extend(flatten(v, f"{prefix}[{i}]"))
    return rows


def record_lists(obj: object, prefix: str = "") -> list[tuple[str, list[dict], list[str]]]:
    """Groups of records: lists of dicts, name -> record maps, and sibling flat dicts such as
    eval.base / eval.sft. Returns (label, rows, path prefixes the rows cover)."""
    found: list[tuple[str, list[dict], list[str]]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, list) and len(v) >= 2 and all(isinstance(x, dict) for x in v):
                found.append((p, v, [p]))
            elif isinstance(v, dict) and len(v) >= 2 and all(isinstance(x, dict) for x in v.values()):
                # mapping name -> record, for example per-act or per-split statistics
                found.append((p, expand_records(v), [p]))
            elif isinstance(v, dict):
                flat = {n: x for n, x in v.items() if isinstance(x, dict) and x
                        and not any(isinstance(y, dict) for y in x.values())}
                if len(flat) >= 2:
                    found.append((p, expand_records(flat), [f"{p}.{n}" for n in flat]))
                found.extend(e for e in record_lists({n: x for n, x in v.items() if n not in flat}, p))
    return found


def expand_records(mapping: dict, prefix: str = "") -> list[dict]:
    """Rows from name -> record maps; nested maps of maps become name/subname rows."""
    rows: list[dict] = []
    for name, rec in mapping.items():
        label = f"{prefix}/{name}" if prefix else str(name)
        if isinstance(rec, dict) and rec and all(isinstance(x, dict) for x in rec.values()):
            rows.extend(expand_records(rec, label))
        elif isinstance(rec, dict):
            rows.append({"name": label, **rec})
    return rows


# Metric columns from the plan (section 5.6), shown first when a record has them.
PRIORITY_COLS = ["name", "n", "reward", "f1_benefits", "acc_office", "f1_documents", "cite_valid",
                 "next_step_correct", "excess_questions_median", "excess_questions_p90",
                 "boundary_violations", "pass^1"]


def is_noise_key(path: str) -> bool:
    last = path.split(".")[-1].lower()
    return any(t in last for t in ("command", "argv", "path", "description", "_dir"))


def table(label: str, caption: str, header: list[str], rows: list[list[str]], spec: str | None = None,
          note: str | None = None, wide: bool = False) -> str:
    spec = spec or ("l" * len(header))
    lines = [r"\begin{table}[htbp]", r"\centering", r"\small"]
    lines.append(rf"\caption{{{caption}}}")
    lines.append(rf"\label{{{label}}}")
    if wide:
        lines.append(r"\resizebox{\ifdim\width>\linewidth\linewidth\else\width\fi}{!}{%")
    lines.append(rf"\begin{{tabular}}{{{spec}}}")
    lines.append(r"\toprule")
    lines.append(" & ".join(header) + r" \\")
    lines.append(r"\midrule")
    for r in rows:
        lines.append(" & ".join(r) + r" \\")
    lines.append(r"\bottomrule")
    lines.append(r"\end{tabular}" + ("}" if wide else ""))
    if note:
        lines.append(rf"\par\smallskip\parbox{{0.95\linewidth}}{{\footnotesize {note}}}")
    lines.append(r"\end{table}")
    return "\n".join(lines) + "\n"


def not_run(label: str, caption: str, header: list[str], what: str) -> str:
    row = [r"\emph{not run}"] + [""] * (len(header) - 1)
    return table(label, caption, header, [row],
                 note=f"No result file for {tex(what)} existed when the paper was built.")


def write(name: str, content: str) -> None:
    (OUT / name).write_text(content, encoding="utf-8")


# ---------------------------------------------------------------- result discovery


def load_results() -> list[tuple[Path, object]]:
    found: list[tuple[Path, object]] = []
    if RESULTS.is_dir():
        for p in sorted(RESULTS.rglob("*.json")):
            try:
                found.append((p, json.loads(p.read_text(encoding="utf-8"))))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"skip {rel(p)}: {exc}", file=sys.stderr)
    return found


def tags(path: Path, data: object) -> str:
    s = path.stem.lower()
    if isinstance(data, dict):
        for k in ("kind", "type", "stage", "suite", "run", "name", "task", "experiment"):
            v = data.get(k)
            if isinstance(v, str):
                s += " " + v.lower()
    return s


def pick(results: list[tuple[Path, object]], include: tuple[str, ...], exclude: tuple[str, ...] = ()) -> list[tuple[Path, object]]:
    out = []
    for p, d in results:
        t = tags(p, d)
        if any(i in t for i in include) and not any(e in t for e in exclude):
            out.append((p, d))
    return out


def generic_tables(label: str, caption: str, files: list[tuple[Path, object]], what: str) -> str:
    """Key/value summary of each result file plus its first list of records."""
    if not files:
        return not_run(label, caption, ["Quantity", "Value"], what)
    parts = []
    for n, (path, data) in enumerate(files):
        lab = label if n == 0 else f"{label}-{n}"
        cap = f"{caption} Source: \\texttt{{{tex(rel(path))}}} (sha256 {sha12(path)})."
        lists = record_lists(data)
        list_paths = {pre for _, _, pres in lists for pre in pres}
        scalars = [(k, v) for k, v in flatten(data)
                   if not any(k.startswith(lp + "[") or k.startswith(lp + ".") for lp in list_paths) and not is_noise_key(k)]
        rows = [[key_label(k), fmt(v)] for k, v in scalars[:MAX_ROWS]]
        note = None
        if len(scalars) > MAX_ROWS:
            note = f"{len(scalars) - MAX_ROWS} further fields are in the result file."
        if rows:
            parts.append(table(lab, cap, ["Quantity", "Value"], rows, spec=r">{\raggedright\arraybackslash}p{0.45\linewidth}>{\raggedright\arraybackslash}p{0.45\linewidth}", note=note))
        for m, (lp, recs, _) in enumerate(lists[:3]):
            cols: list[str] = []
            for r in recs:
                for k, v in r.items():
                    if not isinstance(v, (dict, list)) and k not in cols and not is_noise_key(k):
                        cols.append(k)
            cols = [c for c in PRIORITY_COLS if c in cols] + [c for c in cols if c not in PRIORITY_COLS]
            cols = cols[:MAX_COLS]
            lcap = f"{caption} Records \\texttt{{{tex(lp)}}} from \\texttt{{{tex(rel(path))}}}."
            if len(cols) > 6 and len(recs) <= 5 and cols[0] == "name":
                # few wide records (for example metrics overall and per language): transpose
                head = ["Metric"] + [fmt(r.get("name")) for r in recs]
                body = [[tex(c)] + [fmt(r.get(c)) for r in recs] for c in cols[1:]]
                parts.append(table(f"{lab}-list{m}", lcap, head, body, spec="l" + "r" * len(recs), wide=True))
                continue
            body = [[fmt(r.get(c)) for c in cols] for r in recs[:MAX_ROWS]]
            rnote = f"{len(recs) - MAX_ROWS} further rows are in the result file." if len(recs) > MAX_ROWS else None
            parts.append(table(f"{lab}-list{m}", lcap,
                               [tex(c) for c in cols], body, spec="l" + "r" * (len(cols) - 1),
                               note=rnote, wide=True))
        if not parts:
            parts.append(not_run(label, caption, ["Quantity", "Value"], what))
    return "\n".join(parts)


# ---------------------------------------------------------------- world statistics


def world_table() -> str:
    cat = KNOWLEDGE / "catalog"
    rows: list[list[str]] = []
    if cat.is_dir():
        records = sorted(cat.glob("*.yaml"))
        areas: dict[str, int] = {}
        criteria = 0
        for p in records:
            text = p.read_text(encoding="utf-8")
            m = re.search(r"^area:\s*\"?([A-F])\"?\s*$", text, re.M)
            areas[m.group(1) if m else "?"] = areas.get(m.group(1) if m else "?", 0) + 1
            block = re.search(r"^criteria:\s*\n((?:[ \-].*\n)+)", text, re.M)
            if block:
                criteria += len(re.findall(r"^  - id:", block.group(1), re.M))
        rows.append(["Catalog records (benefits and offers)", fmt(len(records))])
        for a in sorted(areas):
            rows.append([f"\\quad area {a}", fmt(areas[a])])
        rows.append(["Eligibility criteria in catalog records", fmt(criteria)])
    def count(sub: str, pattern: str) -> int:
        d = KNOWLEDGE / sub
        return len(list(d.rglob(pattern))) if d.is_dir() else 0
    rows.append(["Process definitions (YAML)", fmt(count("processes", "*.yaml"))])
    rows.append(["Office directory files (YAML)", fmt(count("offices", "*.yaml"))])
    rows.append(["Form schemas (JSON)", fmt(count("forms", "*.json"))])
    rows.append(["Guard rule files", fmt(count("guards", "*.yaml") + count("guards", "*.json"))])
    try:
        sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short=10", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        sha = "unknown"
    return table("tab:world", f"The AT-Benefits world as loaded from \\texttt{{packages/knowledge}} at commit \\texttt{{{tex(sha)}}}. Counts are computed from the repository at build time.",
                 ["Component", "Count"], rows, spec="lr")


# ---------------------------------------------------------------- product evals


def clean_md(s: str) -> str:
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    s = " ".join(s.replace("**", "").replace("`", "").split())
    return s


def md_table_after(md: str, header_prefix: str) -> list[list[str]]:
    lines = md.splitlines()
    for i, line in enumerate(lines):
        if line.startswith(header_prefix):
            out = []
            for row in lines[i + 2:]:
                if not row.startswith("|"):
                    break
                out.append([clean_md(c) for c in row.strip().strip("|").split("|")])
            return out
    return []


def product_table() -> tuple[str, bool]:
    label = "tab:product"
    caption = ("Product evaluation suites of SV KI-Lotse, measured on the product (its engine, guards and configured frontier models), "
               "parsed from \\texttt{docs/evals/results.md}. These are product evaluations, not results of the trained research models.")
    header = ["Suite", "Observations", "Measured result"]
    if not EVALS_MD.is_file():
        return not_run(label, caption, header, "docs/evals/results.md"), False
    md = EVALS_MD.read_text(encoding="utf-8")
    rows: list[list[str]] = []
    m = re.search(r"Latest full run: \*\*(.+?)\*\*", md, re.S)
    if m:
        detail = clean_md(m.group(1))
        n = re.search(r"(\d+)/(\d+) passed", detail)
        obs = f"{n.group(2)} labelled red-team cases" if n else ""
        extra = []
        for lab, pat in (("benign FPR", r"Benign false-positive rate: \*\*(.+?)\*\*"),
                         ("FNR", r"False-negative rate: \*\*(.+?)\*\*")):
            mm = re.search(pat, md, re.S)
            if mm:
                extra.append(f"{lab} {clean_md(mm.group(1))}")
        rows.append(["E5 Safety (latest guard run)", tex(obs), tex("; ".join([detail] + extra))])
    for r in md_table_after(md, "| Suite | Observations | Measured result"):
        if len(r) < 3 or "superseded" in r[0].lower():
            continue
        rows.append([tex(r[0]), tex(r[1]), tex(r[2])])
    for r in md_table_after(md, "| Batch | Judged / attempted | Verified task successes"):
        if len(r) < 3:
            continue
        rows.append([tex("E4 " + r[0]), tex("judged/attempted: " + r[1]), tex(r[2])])
    if not rows:
        return not_run(label, caption, header, "parsable product evaluation results"), False
    body = table(label, caption, header, rows,
                 spec=r">{\raggedright\arraybackslash}p{0.24\linewidth}>{\raggedright\arraybackslash}p{0.24\linewidth}>{\raggedright\arraybackslash}p{0.42\linewidth}",
                 note=f"Source sha256 {sha12(EVALS_MD)}. Intervals, targets and caveats for every suite are in the source document.")
    return body, True


# ---------------------------------------------------------------- quantum (T9)


def dig(d: object, *keys: str) -> object:
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def quantum_tables(path: Path, data: dict) -> str:
    """T9 from ml/quantum/results.json: instances with classical baselines, QAOA on the
    simulator, and the IBM hardware run (or its not-run status)."""
    src = f"Source: \\texttt{{{tex(rel(path))}}} (sha256 {sha12(path)})."
    parts = []
    runs = dig(data, "aer", "runs") or []
    if runs:
        rows = []
        for r in runs:
            b = r.get("baselines", {})
            rows.append([fmt(r.get("name")), fmt(r.get("kind")), fmt(r.get("qubits")), fmt(r.get("optimum")),
                         fmt(dig(b, "sa", "approx_ratio")), fmt(dig(b, "sa", "feasibility_rate")),
                         fmt(dig(b, "greedy", "approx_ratio")),
                         fmt(dig(r, "qubo_ground_state", "equals_cpsat_optimum"))])
        parts.append(table("tab:quantum", "T9 instances from catalog data with classical baselines: CP-SAT optimum, "
                           "simulated annealing (SA) and greedy (set cover only) approximation ratios, and whether the "
                           f"QUBO ground state equals the CP-SAT optimum. {src}",
                           ["Instance", "Kind", "Qubits", "CP-SAT opt.", "SA ratio", "SA feasible", "Greedy ratio", "QUBO = opt."],
                           rows, spec="llrrrrrr", wide=True))
        qrows = []
        for r in runs:
            for e in r.get("qaoa", []):
                qrows.append([fmt(r.get("name")), fmt(r.get("qubits")), fmt(e.get("variant")), fmt(e.get("p")),
                              fmt(e.get("transpiled_depth")), fmt(e.get("two_qubit_gates")), fmt(e.get("shots")),
                              fmt(e.get("feasibility_rate")), fmt(e.get("approx_ratio_best")), fmt(e.get("p_opt"))])
        if qrows:
            note = f"{len(qrows) - 40} further rows are in the result file." if len(qrows) > 40 else None
            parts.append(table("tab:quantum-sim", "T9 QAOA on the Aer simulator: transpiled depth, two-qubit gates, "
                               f"feasibility rate, best approximation ratio and probability of the optimum. {src}",
                               ["Instance", "Qubits", "Variant", "$p$", "Depth", "2q gates", "Shots", "Feasible",
                                "Ratio (best)", "$P(\\text{opt})$"],
                               qrows[:40], spec="lrlrrrrrrr", note=note, wide=True))
    hw = data.get("hardware")
    if isinstance(hw, dict):
        circ = hw.get("circuits") or []
        if hw.get("status") == "done" and circ:
            hrows = [[fmt(c.get("name")), fmt(c.get("qubits")), fmt(c.get("variant")), fmt(c.get("p")),
                      fmt(c.get("transpiled_depth")), fmt(c.get("two_qubit_gates")), fmt(c.get("physical_qubits")),
                      fmt(c.get("feasibility_rate")), fmt(c.get("approx_ratio_best")), fmt(c.get("p_opt"))] for c in circ]
            parts.append(table("tab:quantum-hw", f"T9 QAOA on IBM hardware (backend \\texttt{{{fmt(hw.get('backend'))}}}, "
                               f"{fmt(hw.get('shots'))} shots, job \\texttt{{{fmt(hw.get('job_id'))}}}). {src}",
                               ["Instance", "Qubits", "Variant", "$p$", "Depth", "2q gates", "Phys. qubits", "Feasible",
                                "Ratio (best)", "$P(\\text{opt})$"], hrows, spec="lrlrrrrrrr", wide=True))
        else:
            reason = hw.get("reason") or f"status {hw.get('status')}"
            parts.append(table("tab:quantum-hw", f"T9 IBM hardware run. {src}", ["Backend", "Status"],
                               [[fmt(hw.get("backend")), r"\emph{not run}: " + tex(reason)]],
                               spec=r"l>{\raggedright\arraybackslash}p{0.7\linewidth}"))
    else:
        parts.append(not_run("tab:quantum-hw", "T9 IBM hardware run.", ["Backend", "Status"], "an IBM hardware run"))
    if not runs:
        parts.insert(0, not_run("tab:quantum", "T9 instances and simulator runs.", ["Quantity", "Value"],
                                "simulator runs of the quantum study"))
    return "\n".join(parts)


# ---------------------------------------------------------------- experiment status


PLANNED = [
    ("T1", "Main comparison (frontier, engine, SFT, SFT+GRPO)", ("t1", "main", "grpo")),
    ("T2", "Base comparison A3B vs Euro-9B", ("t2", "base_comparison", "head2head")),
    ("T3", "Reward ablation", ("t3", "reward_ablation", "ablation")),
    ("T4", "Simulator open vs frontier", ("t4", "simulator")),
    ("T5", "Generalization and process synthesis", ("t5", "generalization", "synthesis")),
    ("T6", "Real-text population", ("t6", "real_text", "realtext")),
    ("T7", "Supporting models", ("t7", "guard_model", "einfach", "retrieval", "point")),
    ("T8", "Cost and latency", ("t8", "latency", "cost")),
]


def status_table(results, have_quantum: bool) -> tuple[str, list[str]]:
    rows = []
    measured: list[str] = []
    for tid, name, keys in PLANNED:
        hits = [rel(p) for p, d in results
                if any(re.search(rf"(^|[^a-z0-9]){re.escape(k)}([^a-z0-9]|$)", tags(p, d)) for k in keys)]
        if hits:
            measured.append(tid)
        rows.append([tid, tex(name), r"\texttt{" + tex(", ".join(hits)) + "}" if hits else r"\emph{not run}"])
    rows.append(["T9", "Quantum (QAOA vs CP-SAT vs annealing)",
                 r"\texttt{ml/quantum/results.json}" if have_quantum else r"\emph{not run}"])
    if have_quantum:
        measured.append("T9")
    t = table("tab:status", "Planned experiment tables (Section~\\ref{sec:experiments}) and the result files found when the paper was built.",
              ["Table", "Content", "Result file"], rows,
              spec=r"l>{\raggedright\arraybackslash}p{0.45\linewidth}>{\raggedright\arraybackslash}p{0.33\linewidth}")
    return t, measured


# ---------------------------------------------------------------- main


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    results = load_results()
    used: list[Path] = []

    write("tab_world.tex", world_table())

    groups = {
        "personas": (("persona",), ("publish",)),
        "corpus": (("corpus",), ("publish",)),
        "release": (("publish",), ()),
        "selftest": (("selftest", "self_test", "gym"), ()),
        "sft": (("sft",), ()),
    }
    found: dict[str, list] = {}
    for g, (inc, exc) in groups.items():
        found[g] = pick(results, inc, exc)
    # Prefer the combined SFT smoke record over its intermediate train/eval files.
    smoke = [(p, d) for p, d in found["sft"] if isinstance(d, dict) and d.get("stage") == "sft_smoke"]
    if smoke:
        found["sft"] = smoke[-1:]
    # The persona generator also writes a summary next to its data; use it when committed.
    if not found["personas"]:
        for p in sorted((ROOT / "ml").glob("**/personas/**/*summary*.json")):
            try:
                found["personas"].append((p, json.loads(p.read_text(encoding="utf-8"))))
            except (OSError, json.JSONDecodeError):
                pass
    for g in groups:
        used += [p for p, _ in found[g]]

    write("tab_personas.tex", generic_tables("tab:personas", "AT-Benefits persona statistics.", found["personas"], "the persona generator"))
    write("tab_corpus.tex", generic_tables("tab:corpus", "Austrian law corpus statistics.", found["corpus"], "the corpus build"))
    write("tab_selftest.tex", generic_tables("tab:selftest", "Gym self-test: reward checks on engine gold plans and deliberately perturbed plans (not an agent evaluation).", found["selftest"], "the gym self-test"))
    write("tab_sft.tex", generic_tables("tab:sft", "SFT smoke run: a short LoRA run that tests the pipeline, "
                                        "evaluated on a single-turn plan proxy rather than the multi-turn gym; "
                                        "it is not a result of the planned SFT stage.", found["sft"], "an SFT run"))

    if found["release"]:
        rrows = []
        for p, d in found["release"]:
            if isinstance(d, dict):
                rrows.append([fmt(d.get("dataset") or d.get("model") or p.stem), r"\url{" + str(d.get("url", "")) + "}",
                              fmt(d.get("records") if d.get("records") is not None else d.get("n")), fmt(d.get("published_at"))])
        write("tab_release.tex", table("tab:release", "Published artefacts on Hugging Face, from \\texttt{ml/results/publish-*.json}.",
                                       ["Artefact", "URL", "Records", "Published"], rrows, spec="llrl", wide=True))
    else:
        write("tab_release.tex", not_run("tab:release", "Published artefacts on Hugging Face.", ["Artefact", "URL"], "a release"))

    quantum: list[tuple[Path, object]] = []
    if QUANTUM.is_file():
        try:
            quantum = [(QUANTUM, json.loads(QUANTUM.read_text(encoding="utf-8")))]
            used.append(QUANTUM)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"skip {rel(QUANTUM)}: {exc}", file=sys.stderr)
    if quantum and isinstance(quantum[0][1], dict):
        try:
            qt = quantum_tables(*quantum[0])
        except Exception as exc:  # unexpected shape: fall back to the generic rendering
            print(f"quantum: generic rendering ({exc})", file=sys.stderr)
            qt = generic_tables("tab:quantum", "T9 quantum study.", quantum, "the quantum study")
    else:
        qt = generic_tables("tab:quantum", "T9 quantum study.", quantum, "the quantum study")
    write("tab_quantum.tex", qt)

    product, have_product = product_table()
    write("tab_product.tex", product)

    status, measured_tables = status_table(results, bool(quantum))
    write("tab_status.tex", status)

    # Sentences for the abstract and conclusion, derived from what exists.
    have = []
    if found["corpus"]:
        have.append("the Austrian law corpus build")
    if found["personas"]:
        have.append("the persona generator")
    if found["selftest"]:
        have.append("the gym self-test")
    if found["sft"]:
        have.append("an SFT smoke run")
    if quantum:
        have.append("the quantum study")
    trained = any(t in measured_tables for t in ("T1", "T2", "T3"))

    def join(xs: list[str]) -> str:
        return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]

    if have:
        research = f"Result files from the research lane exist for {join(have)}; their tables are generated from those files."
    else:
        research = "No result files from the research lane existed when this version was built; every research table reads \\emph{not run}."
    if found["sft"] and not trained:
        agents = ("An SFT smoke run tests the training pipeline (Table~\\ref{tab:sft}); the trained agent models "
                  "(full SFT, multi-turn GRPO and DPO) and the comparisons T1--T8 have not been run, are described as "
                  "planned work, and no claim about their performance is made.")
    elif trained:
        agents = "Result files for agent-training tables exist and are reported in Table~\\ref{tab:status}."
    else:
        agents = ("The trained agent models (SFT, multi-turn GRPO and DPO) and the comparisons T1--T8 have not been run; "
                  "they are described as planned work and no claim about their performance is made.")
    product_s = ("The product's own evaluation suites are reported separately as product baselines."
                 if have_product else "")
    files = "; ".join(f"\\nolinkurl{{{rel(p)}}} ({sha12(p)})" for p in used) or "none"
    write("status.tex",
          "% generated by scripts/tables.py\n"
          f"\\newcommand{{\\StatusResearch}}{{{research}}}\n"
          f"\\newcommand{{\\StatusAgents}}{{{agents}}}\n"
          f"\\newcommand{{\\StatusProduct}}{{{product_s}}}\n"
          f"\\newcommand{{\\StatusFiles}}{{{files}}}\n")

    print(f"tables written to {rel(OUT)}; research result files used: {len(used)}; "
          f"product evals: {'yes' if have_product else 'no'}; measured tables: {', '.join(measured_tables) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
