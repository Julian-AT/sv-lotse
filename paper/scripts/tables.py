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
    t = table("tab:status", "Planned experiment tables (Section~\\ref{sec:future}) and the result files found when the paper was built.",
              ["Table", "Content", "Result file"], rows,
              spec=r"l>{\raggedright\arraybackslash}p{0.45\linewidth}>{\raggedright\arraybackslash}p{0.33\linewidth}")
    return t, measured


# ---------------------------------------------------------------- data release


CARD = PAPER / "sources" / "hf-at-benefits-README.md"
CARD_URL = "https://huggingface.co/datasets/JulianAT/at-benefits"


def newest(results: list[tuple[Path, object]], prefix: str) -> tuple[Path, dict] | None:
    """The result file of a family; with several, the one committed last (then modified last)."""
    hits = [(p, d) for p, d in results if p.name.startswith(prefix) and isinstance(d, dict)]
    if not hits:
        return None

    def when(p: Path) -> int:
        try:
            out = subprocess.run(["git", "-C", str(ROOT), "log", "-1", "--format=%ct", "--", str(p)],
                                 capture_output=True, text=True, check=True).stdout.strip()
            return int(out or 0)
        except (OSError, subprocess.CalledProcessError, ValueError):
            return 0
    return max(hits, key=lambda h: (when(h[0]), h[0].stat().st_mtime))


def card_documents() -> dict | None:
    """Counts of the documents config, which only the published dataset card records."""
    if not CARD.is_file():
        return None
    text = CARD.read_text(encoding="utf-8")
    m = re.search(r"\*\*(\d+) documents\*\* \(([^)]*)\), (\d+) pages, (\d+) gold statements", text)
    j = re.search(r"Pass rate so far:\s*(\d+)/(\d+) \(([0-9.]+); Wilson 95 % \[([0-9.]+), ([0-9.]+)\]\)", text)
    if not m:
        return None
    out: dict = {"documents": int(m.group(1)), "splits": m.group(2), "pages": int(m.group(3)),
                 "statements": int(m.group(4))}
    if j:
        out.update(judge_passed=int(j.group(1)), judge_n=int(j.group(2)), judge_rate=float(j.group(3)),
                   judge_lo=float(j.group(4)), judge_hi=float(j.group(5)))
    return out


def f2(x: object) -> str:
    return f"{x:.2f}" if isinstance(x, (int, float)) else "--"


def f3(x: object) -> str:
    return f"{x:.3f}" if isinstance(x, (int, float)) else "--"


def src_cell(p: Path) -> str:
    return r"\nolinkurl{" + p.name + "}"  # file names are [A-Za-z0-9._-]; nolinkurl may break lines


def ds_cell(name: str, config: str | None = None) -> str:
    cell = r"\nolinkurl{" + name + "}"
    return cell + (r" / \texttt{" + tex(config) + "}" if config else "")


def data_release(results: list[tuple[Path, object]], macros: dict[str, str]) -> tuple[str, list[Path]]:
    """Compact table of the released datasets (Hugging Face) from the datagen and publish result files."""
    used: list[Path] = []
    rows: list[list[str]] = []

    def name(config: str) -> str:
        return r"\texttt{" + tex(config) + "}"

    def ci(lo: object, hi: object) -> str:
        return f"[{f3(lo)}, {f3(hi)}]" if isinstance(lo, (int, float)) and isinstance(hi, (int, float)) else ""

    dlg = newest(results, "datagen-dialogues-")
    if dlg:
        p, d = dlg
        used.append(p)
        tier = d.get("per_tier", {})
        langs = len(d.get("per_language", {}))
        macros.update(DataDialogues=fmt(d.get("release_rows")), DataDialoguesO=fmt(tier.get("O")),
                      DataDialoguesA=fmt(tier.get("A")), DataDialoguesB=fmt(tier.get("B")),
                      DataDialoguesLangs=fmt(langs),
                      DataDialoguesJudge=fmt(d.get("tier_A_judge_pass_rate_all_attempts")),
                      DataDialoguesJudgeN=fmt(d.get("tier_A_judged")))
        rows.append([name("at-benefits/dialogues"), fmt(d.get("release_rows")),
                     f"tier O {fmt(tier.get('O'))}, A {fmt(tier.get('A'))}, B {fmt(tier.get('B'))}; {fmt(langs)} languages",
                     f"judge pass {fmt(d.get('tier_A_judge_pass_rate_all_attempts'))} of tier A attempts "
                     f"($n={fmt(d.get('tier_A_judged'))}$); boundary flags {fmt(d.get('boundary_flags'))}"])

    sit = newest(results, "datagen-situations-")
    if sit:
        p, d = sit
        used.append(p)
        counts = d.get("counts", {})
        total = sum(v for v in counts.values() if isinstance(v, int))
        llm = sum(v for k, v in counts.items() if k.endswith("/llm") and isinstance(v, int))
        jd = dig(d, "natural", "judge") or {}
        lo, hi = (jd.get("wilson_95") or [None, None])[:2]
        variants = len([k for k in d.get("languages", {}) if k.startswith("llm/")])
        macros.update(DataSituations=fmt(total), DataSituationsLLM=fmt(llm),
                      DataSituationsJudge=f2(jd.get("pass_rate")), DataSituationsJudgeLo=f3(lo),
                      DataSituationsJudgeHi=f3(hi), DataSituationsJudgeN=fmt(jd.get("n")))
        rows.append([name("at-benefits/situations"), fmt(total),
                     f"{fmt(total - llm)} template, {fmt(llm)} LLM-rewritten ({fmt(variants)} variants)",
                     f"judge pass {f2(jd.get('pass_rate'))} {ci(lo, hi)}, $n={fmt(jd.get('n'))}$"])

    docs = card_documents()
    if docs:
        used.append(CARD)
        macros.update(DataDocuments=fmt(docs["documents"]), DataStatements=fmt(docs["statements"]))
        judge = ""
        if "judge_n" in docs:
            judge = (f"judge pass {fmt(docs['judge_passed'])}/{fmt(docs['judge_n'])} "
                     f"{ci(docs['judge_lo'], docs['judge_hi'])}")
        rows.append([name("at-benefits/documents") + r"$^{\dagger}$", fmt(docs["documents"]),
                     f"{fmt(docs['pages'])} pages, {fmt(docs['statements'])} gold statements", judge or "--"])

    frm = newest(results, "datagen-forms-")
    if frm:
        p, d = frm
        used.append(p)
        jd = d.get("judge", {})
        macros.update(DataForms=fmt(d.get("instances")), DataFormTemplates=fmt(d.get("templates")))
        rows.append([name("at-benefits/forms"), fmt(d.get("instances")),
                     f"{fmt(d.get('templates'))} templates; {fmt(dig(d, 'release', 'rows_with_pdf'))} with PDF",
                     f"values from prefill policy; judge sample {fmt(jd.get('pass_rate'))}, $n={fmt(jd.get('n'))}$"])

    lqa = newest(results, "datagen-legal-qa-")
    if lqa:
        p, d = lqa
        used.append(p)
        jd = d.get("judge", {})
        lo, hi = (jd.get("pass_rate_ci95") or [None, None])[:2]
        macros.update(DataLegalQA=fmt(d.get("final")), DataLegalQAJudge=fmt(jd.get("pass_rate")),
                      DataLegalQABMRecall=fmt(dig(d, "bm25_rank_de", "recall@10")))
        rows.append([name("at-benefits/legal_qa"), fmt(d.get("final")),
                     f"{fmt(len(d.get('by_act', {})))} acts, {fmt(len(d.get('by_language', {})))} language variants; "
                     f"BM25 R@10 {fmt(dig(d, 'bm25_rank_de', 'recall@10'))}",
                     f"judge pass {fmt(jd.get('pass_rate'))} {ci(lo, hi)}, $n={fmt(jd.get('n'))}$"])

    per = newest(results, "publish-personas")
    if per:
        p, d = per
        used.append(p)
        sc = d.get("split_counts", {})
        total = sum(v for v in sc.values() if isinstance(v, int))
        macros.update(DataPersonas=fmt(total))
        rows.append([name("at-benefits-personas"), fmt(total), f"{fmt(len(sc))} splits (Table~\\ref{{tab:personas}})",
                     f"leakage test passed: {fmt(dig(d, 'leakage', 'passed'))}"])

    law = newest(results, "publish-corpus")
    corpus = newest(results, "corpus-")
    if law:
        p, d = law
        used.append(p)
        attribution = corpus[1].get("attribution") if corpus else None
        macros.update(DataLaw=fmt(d.get("records")))
        if attribution:
            macros.update(DataLawAttribution=tex(attribution))
        rows.append([name("at-sv-law"), fmt(d.get("records")), "sections of consolidated federal law (RIS)",
                     f"licence {tex(str(d.get('licence', '')).replace('-', ' '))}; complete: {fmt(d.get('complete'))}"])

    srcs = ", ".join(r"\nolinkurl{" + q.name + "}" for q in used if q != CARD)
    caption = (r"Released datasets (\url{https://huggingface.co/JulianAT}). Labels are computed by product code; "
               r"judge pass rates (95\% intervals in brackets) come from uncalibrated LLM judges.")
    note = (f"Sources: {srcs}. $^{{\\dagger}}$Counts from the published dataset card, snapshot "
            r"\nolinkurl{paper/sources/hf-at-benefits-README.md}" + (f" (sha256 {sha12(CARD)})." if CARD.is_file() else "."))
    if not rows:
        return not_run("tab:data", caption, ["Dataset", "Rows"], "a dataset release"), used
    pc = r">{\raggedright\arraybackslash}p"
    spec = f"{pc}{{0.24\\linewidth}}r{pc}{{0.29\\linewidth}}{pc}{{0.30\\linewidth}}"
    return compact("tab:data", caption, ["Dataset", "Rows", "Composition", "Quality check"], rows, spec,
                   note=note, size=r"\footnotesize"), used


# ---------------------------------------------------------------- curated tables (v2 layout)


def compact(label: str, caption: str, header: list[str], rows: list, spec: str,
            note: str | None = None, star: bool = False, size: str = r"\small") -> str:
    """A booktabs table without the resize box, for the curated main-text tables."""
    env = "table*" if star else "table"
    lines = [rf"\begin{{{env}}}[t]", r"\centering", size, rf"\caption{{{caption}}}", rf"\label{{{label}}}",
             r"\setlength{\tabcolsep}{4pt}", rf"\begin{{tabular}}{{{spec}}}", r"\toprule",
             " & ".join(header) + r" \\", r"\midrule"]
    for r in rows:
        lines.append(r if isinstance(r, str) else " & ".join(r) + r" \\")
    lines += [r"\bottomrule", r"\end{tabular}"]
    if note:
        lines.append(rf"\par\smallskip{{\footnotesize\raggedright {note}\par}}")
    lines.append(rf"\end{{{env}}}")
    return "\n".join(lines) + "\n"


def world_compact(macros: dict[str, str]) -> str:
    cat = KNOWLEDGE / "catalog"
    records = sorted(cat.glob("*.yaml")) if cat.is_dir() else []
    areas: dict[str, int] = {}
    criteria = 0
    for p in records:
        text = p.read_text(encoding="utf-8")
        m = re.search(r"^area:\s*\"?([A-F])\"?\s*$", text, re.M)
        areas[m.group(1) if m else "?"] = areas.get(m.group(1) if m else "?", 0) + 1
        block = re.search(r"^criteria:\s*\n((?:[ \-].*\n)+)", text, re.M)
        if block:
            criteria += len(re.findall(r"^  - id:", block.group(1), re.M))

    def count(sub: str, *patterns: str) -> int:
        d = KNOWLEDGE / sub
        return sum(len(list(d.rglob(pt))) for pt in patterns) if d.is_dir() else 0
    procs, offices, forms = count("processes", "*.yaml"), count("offices", "*.yaml"), count("forms", "*.json")
    guards = count("guards", "*.yaml", "*.json")
    macros.update(WorldRecords=fmt(len(records)), WorldCriteria=fmt(criteria), WorldProcesses=fmt(procs),
                  WorldOfficeFiles=fmt(offices), WorldForms=fmt(forms), WorldGuardFiles=fmt(guards),
                  WorldAreas=fmt(len([a for a in areas if a != "?"])))
    letters = [a for a in "ABCDEF" if a in areas]
    head = ["Records"] + [f"{a}" for a in letters] + ["Criteria", "Processes", "Office files", "Forms", "Guard rules"]
    row = [fmt(len(records))] + [fmt(areas[a]) for a in letters] + [fmt(criteria), fmt(procs), fmt(offices), fmt(forms), fmt(guards)]
    try:
        sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short=10", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        sha = "unknown"
    span = len(letters)
    top = (r"& \multicolumn{" + str(span) + r"}{c}{Records per area} & & & & & \\"
           + r" \cmidrule(lr){2-" + str(span + 1) + "}")
    lines = [r"\begin{table}[t]", r"\centering", r"\small",
             rf"\caption{{The rule world, counted from \texttt{{packages/knowledge}} at commit \texttt{{{tex(sha)}}} when the paper "
             r"was built. Areas: A prevention, B health promotion, C treatment and rehabilitation, D care, "
             r"E family and social support, F appointments and approvals.}",
             r"\label{tab:world}", r"\setlength{\tabcolsep}{4.5pt}",
             r"\begin{tabular}{r" + "r" * span + "rrrrr}", r"\toprule", top,
             " & ".join(head) + r" \\", r"\midrule", " & ".join(row) + r" \\", r"\bottomrule", r"\end{tabular}",
             r"\end{table}"]
    return "\n".join(lines) + "\n"


def persona_compact(files: list[tuple[Path, object]], macros: dict[str, str]) -> str:
    label, caption = "tab:personas", "AT-Benefits persona splits."
    head = ["Split", "Personas", r"Mean $q_{\min}$", "Mean text length (chars)"]
    hit = next(((p, d) for p, d in files if isinstance(d, dict) and isinstance(d.get("splits"), dict)), None)
    if not hit:
        return not_run(label, caption, head, "the persona generator")
    path, data = hit
    rows = []
    for name, s in data["splits"].items():
        chars = s.get("mean_text_chars")
        rows.append([tex(name.replace("_", " ")), fmt(s.get("n")), f2(s.get("min_questions_mean")),
                     f"{chars:.0f}" if isinstance(chars, (int, float)) else "--"])
    leak = data.get("leakage") or {}
    checks = data.get("checks") or {}
    gen = data.get("generation") or {}
    macros.update(LeakTextF=f3(leak.get("text_f1")), LeakCardF=f3(leak.get("card_f1")),
                  LeakBaseF=f3(leak.get("base_rate_f1")), LeakMargin=fmt(leak.get("margin")),
                  LeakLabels=fmt(leak.get("n_labels")), LeakNTrain=fmt(leak.get("n_train")),
                  LeakNEval=fmt(leak.get("n_eval")), LeakPassed=fmt(leak.get("passed")),
                  PersonaHeldoutArea=tex(checks.get("heldout_area") or gen.get("heldout_area") or "--"),
                  PersonaGoldErrors=fmt(gen.get("gold_errors")), PersonaRequested=fmt(gen.get("n_requested")))
    for name, s in data["splits"].items():
        key = "".join(w.capitalize() for w in re.split(r"[^A-Za-z]+", name) if w)
        macros[f"Persona{key}N"] = fmt(s.get("n"))
        macros[f"Persona{key}Q"] = f2(s.get("min_questions_mean"))
    note = (f"Gold for every persona is computed by the engine ({fmt(gen.get('gold_errors'))} errors). "
            f"$q_{{\\min}}$: the engine's minimum number of questions. Source: \\nolinkurl{{{path.name}}} "
            f"(sha256 {sha12(path)}).")
    return compact(label, caption, head, rows, "lrrr", note=note)


def selftest_compact(files: list[tuple[Path, object]], macros: dict[str, str]) -> str:
    label = "tab:selftest"
    caption = ("Reward self-test. Each perturbation of an engine gold plan must yield the reward predicted by "
               "Eq.~\\eqref{eq:reward}. This tests the reward and the tool contract, not an agent.")
    head = ["Episode", r"Expected $R$", r"Observed $R$", "Match"]
    hit = next(((p, d) for p, d in files if isinstance(d, dict) and isinstance(d.get("checks"), list)), None)
    if not hit:
        return not_run(label, caption, head, "the gym self-test")
    path, data = hit
    names = {"gold_plan": "engine gold plan", "boundary": "+ boundary violation",
             "uncited_claim_message": "+ uncited eligibility claim", "uncited_plan": "+ plan without citations",
             "malformed_tool_call": "+ malformed tool call", "over_asking_by_3": "+ three excess questions",
             "no_plan": "no plan submitted", "oracle_fake_server": "oracle on a stub tool server"}
    rows = [[tex(names.get(c.get("name"), c.get("name"))), f2(c.get("want")), f2(c.get("got")),
             r"\checkmark" if c.get("ok") else r"$\times$"] for c in data["checks"]]
    live = data.get("live") or {}
    ok = sum(1 for c in data["checks"] if c.get("ok"))
    macros.update(SelfTestChecks=fmt(len(data["checks"])), SelfTestOk=fmt(ok),
                  SelfTestEpisodes=fmt(live.get("episodes")), SelfTestToolErrors=fmt(live.get("tool_errors")),
                  SelfTestGoldMin=f2(live.get("gold_plan_reward_min")))
    note = (f"Live run: {fmt(live.get('episodes'))} engine gold plans played through the research tool server, "
            f"minimum reward {f2(live.get('gold_plan_reward_min'))}, {fmt(live.get('tool_errors'))} tool errors. "
            f"Source: \\nolinkurl{{{path.name}}} (sha256 {sha12(path)}).")
    return compact(label, caption, head, rows, "lccc", note=note)


def corpus_compact(files: list[tuple[Path, object]], macros: dict[str, str]) -> str:
    label, caption = "tab:corpus", "Austrian social-insurance law corpus (\\nolinkurl{JulianAT/at-sv-law}) per act."
    head = ["Act", "Sections", "Characters", "Tokens (est.)"]
    hit = next(((p, d) for p, d in files if isinstance(d, dict) and isinstance(d.get("per_act"), dict)), None)
    if not hit:
        return not_run(label, caption, head, "the corpus build")
    path, data = hit
    acts = data["per_act"]
    rows: list = [[tex(k), fmt(v.get("records")), fmt(v.get("chars")), fmt(v.get("tokens_estimate"))]
                  for k, v in sorted(acts.items(), key=lambda kv: -int(kv[1].get("records") or 0))]
    rows.append(r"\midrule")
    rows.append([r"Total", fmt(data.get("records")), fmt(data.get("chars")), fmt(data.get("tokens_estimate"))])
    macros.update(CorpusActs=fmt(len(acts)), CorpusTokens=fmt(data.get("tokens_estimate")),
                  CorpusAsOf=tex(data.get("version_as_of") or ""))
    note = (f"Source: {tex(data.get('source') or '')}, licence {tex(data.get('licence') or '')}, as of "
            f"{tex(data.get('version_as_of') or '')}; \\nolinkurl{{{path.name}}} (sha256 {sha12(path)}).")
    return compact(label, caption, head, rows, "lrrr", note=note)


def product_compact() -> str:
    """Main-text product table: one row per suite with n, result, Wilson interval and target verdict."""
    label = "tab:product"
    caption = ("Product evaluation of SV KI-Lotse with its configured frontier model, parsed from "
               "\\texttt{docs/evals/results.md}. \\textsc{miss}: below the suite's target.")
    head = ["Suite", "Observations", "Measured result", "95\\% Wilson CI", "Target"]
    if not EVALS_MD.is_file():
        return not_run(label, caption, head, "docs/evals/results.md")
    md = EVALS_MD.read_text(encoding="utf-8")
    rows: list = []
    pc = r">{\raggedright\arraybackslash}p"

    def verdict(s: str) -> str:
        return r"\textsc{miss}" if re.search(r"below|fail", s, re.I) else "met"

    def short(result: str) -> str:
        parts = [p.strip() for p in result.split(";")
                 if p.strip() and not re.search(r"normali[sz]ed|blanks", p, re.I)]
        return tex("; ".join(parts))

    m = re.search(r"Latest full run: \*\*(\d+)/(\d+) passed; (\d+) violations", md)
    if m:
        fpr = re.search(r"Benign false-positive rate: \*\*(.+?)\*\* \(95% Wilson ([0-9.]+[–-][0-9.]+%)\)", md, re.S)
        fnr = re.search(r"False-negative rate: \*\*(.+?)\*\* \(95% Wilson ([0-9.]+[–-][0-9.]+%)\)", md, re.S)
        res = f"{m.group(3)} violations ({m.group(1)}/{m.group(2)} passed)"
        ci = []
        if fpr:
            res += f"; benign FPR {clean_md(fpr.group(1)).split('=')[0].strip()}"
            ci.append(f"FPR {fpr.group(2)}")
        if fnr:
            res += f"; FNR {clean_md(fnr.group(1)).split('=')[0].strip()}"
            ci.append(f"FNR {fnr.group(2)}")
        rows.append([tex("E5 Medical boundary"), tex(m.group(2) + " red-team cases"), tex(res), tex("; ".join(ci)),
                     "met" if m.group(3) == "0" else r"\textsc{miss}"])
    order = []
    for r in md_table_after(md, "| Suite | Observations | Measured result"):
        if len(r) < 5 or "superseded" in r[0].lower():
            continue
        obs = re.sub(r"existing deterministic |labelled |; complete source corpus", "", r[1])
        name = re.sub(r"\s*\((?:v\d+|second pass)\)|,\s*follow-up", "", r[0])
        order.append([tex(name), tex(obs), short(r[2]), tex(r[3]), verdict(r[4])])
    rows.extend(sorted(order, key=lambda x: int(re.sub(r"\D", "", x[0].split()[0]) or 0)))
    judged = succ = 0
    for r in md_table_after(md, "| Batch | Judged / attempted | Verified task successes"):
        j = re.match(r"(\d+)/\d+", r[1]) if len(r) >= 3 else None
        s = re.match(r"(\d+)/\d+", r[2]) if len(r) >= 3 else None
        if j and s:
            judged += int(j.group(1))
            succ += int(s.group(1))
    if judged:
        rows.append([tex("E4 End-to-end scenarios"), f"{judged} judged runs", f"{succ}/{judged} succeed",
                     "-- (shared personas)", r"\textsc{miss}"])
    spec = f"{pc}{{0.15\\linewidth}}{pc}{{0.20\\linewidth}}{pc}{{0.28\\linewidth}}{pc}{{0.20\\linewidth}}l"
    note = (f"Measured with the product's configured frontier model, not with the model of "
            f"Section~\\ref{{sec:training}}. Per-batch E4 results: Table~\\ref{{tab:e4}}. Source sha256 {sha12(EVALS_MD)}.")
    return compact(label, caption, head, rows, spec, note=note, size=r"\footnotesize")


def e4_table() -> str:
    label, caption = "tab:e4", "E4 end-to-end scenario batches as recorded in \\texttt{docs/evals/results.md}."
    head = ["Batch", "Judged / attempted", "Task successes"]
    if not EVALS_MD.is_file():
        return not_run(label, caption, head, "docs/evals/results.md")
    md = EVALS_MD.read_text(encoding="utf-8")
    rows = [[tex(r[0]), tex(r[1]), tex(r[2])]
            for r in md_table_after(md, "| Batch | Judged / attempted | Verified task successes") if len(r) >= 3]
    if not rows:
        return not_run(label, caption, head, "E4 batches")
    pc = r">{\raggedright\arraybackslash}p"
    return compact(label, caption, head, rows, f"{pc}{{0.30\\linewidth}}{pc}{{0.26\\linewidth}}{pc}{{0.36\\linewidth}}",
                   note="S1--S4 are the product's scenario families; successes are scored by an uncalibrated model judge.",
                   size=r"\footnotesize")


SFT_REPORT = RESULTS / "sft-qwen3-8b-data-report.json"
SFT_ADAPTER = RESULTS / "sft-qwen3-8b-adapter-config.json"
SFT_CARD = PAPER / "sources" / "hf-sv-lotse-qwen3-8b-sft-README.md"
SFT_REPO = "JulianAT/sv-lotse-qwen3-8b-sft"


def sft_tables(macros: dict[str, str]) -> tuple[str, str, list[Path]]:
    """Configuration and data mix of the released Qwen3-8B SFT adapter, and the tool-output
    truncation sweep from its data report."""
    used: list[Path] = []
    head = ["Quantity", "Value"]
    if not SFT_REPORT.is_file():
        return (not_run("tab:sft", "SFT run.", head, "an SFT run"),
                not_run("tab:toollimit", "Tool-output truncation.", head, "an SFT data report"), used)
    rep = json.loads(SFT_REPORT.read_text(encoding="utf-8"))
    used.append(SFT_REPORT)
    ad = json.loads(SFT_ADAPTER.read_text(encoding="utf-8")) if SFT_ADAPTER.is_file() else {}
    if ad:
        used.append(SFT_ADAPTER)
    card = SFT_CARD.read_text(encoding="utf-8") if SFT_CARD.is_file() else ""
    if card:
        used.append(SFT_CARD)
    base = re.search(r"^base_model:\s*(\S+)", card, re.M)
    loss = re.search(r"Final eval loss:\s*([0-9]+\.[0-9]+)", card)
    mix = rep.get("train_mix", {})
    used_tier = rep.get("dialogues_used_by_tier", {})
    up = rep.get("upsample", {})
    sit = rep.get("situations_sampled", {})
    lens = rep.get("train_len_p50_p90_max") or [None, None, None]
    o_sub = rep.get("tier_O_subsampled", {})
    langs = sorted(set(rep.get("dialogues_used_by_language", {})) | set(sit.get("by_language", {})))
    mods = ad.get("target_modules") or []
    order = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    mods = [m for m in order if m in mods] + [m for m in mods if m not in order]
    tok, loss_tok = rep.get("train_tokens"), rep.get("train_loss_tokens")
    macros.update(
        SftBase=tex(base.group(1)) if base else "--", SftRepo=tex(SFT_REPO),
        SftRank=fmt(ad.get("r")), SftAlpha=fmt(ad.get("lora_alpha")), SftDropout=fmt(ad.get("lora_dropout")),
        SftModules=fmt(len(mods)), SftMaxLen=fmt(rep.get("maxlen")), SftToolChars=fmt(rep.get("tool_output_char_limit")),
        SftTrain=fmt(rep.get("train_examples")), SftVal=fmt(rep.get("val_examples")),
        SftMixO=fmt(mix.get("dialogue:O")), SftMixA=fmt(mix.get("dialogue:A")), SftMixB=fmt(mix.get("dialogue:B")),
        SftMixS=fmt(mix.get("situation:S")), SftUsedA=fmt(used_tier.get("A")), SftUpA=fmt(up.get("A")),
        SftTokens=fmt(tok), SftLossTokens=fmt(loss_tok), SftTokenBudget=fmt(rep.get("token_budget")),
        SftRawRows=fmt(rep.get("dialogues_train_rows_raw")),
        SftDroppedLen=fmt(rep.get("dialogues_dropped_over_maxlen_total")),
        SftOAvail=fmt(o_sub.get("available")), SftOKept=fmt(o_sub.get("kept")), SftLangs=fmt(len(langs)),
        SftLenMedian=fmt(lens[0]), SftLenPNinety=fmt(lens[1]), SftLenMax=fmt(lens[2]),
        SftValLoss=f"{float(loss.group(1)):.4f}" if loss else "--",
        SftBoundaryDropped=fmt(rep.get("dropped_boundary_flags_nonzero")))
    if isinstance(loss_tok, int) and isinstance(tok, int) and tok:
        macros["SftLossShare"] = f"{100 * loss_tok / tok:.0f}\\%"
    rows: list = [
        r"\multicolumn{2}{l}{\emph{Model}} \\",
        ["Base model", r"\nolinkurl{" + (base.group(1) if base else "--") + "}"],
        ["Adapter", rf"LoRA, $r={fmt(ad.get('r'))}$, $\alpha={fmt(ad.get('lora_alpha'))}$, dropout {fmt(ad.get('lora_dropout'))}"],
        ["Target modules", tex(", ".join(m.replace("_proj", "") for m in mods)) + " projections"],
        ["Max.\\ sequence length", fmt(rep.get("maxlen")) + " tokens"],
        ["Tool outputs", f"truncated to {fmt(rep.get('tool_output_char_limit'))} characters"],
        r"\midrule \multicolumn{2}{l}{\emph{Training data}} \\",
        ["Tier O dialogues (oracle)", f"{fmt(mix.get('dialogue:O'))} (of {fmt(o_sub.get('available'))} that fit)"],
        ["Tier A dialogues (verbalised)", f"{fmt(mix.get('dialogue:A'))} ({fmt(used_tier.get('A'))} dialogues, upsampled $\\times{fmt(up.get('A'))}$)"],
        ["Tier B dialogues (teacher)", fmt(mix.get("dialogue:B"))],
        ["Situation $\\rightarrow$ plan", f"{fmt(mix.get('situation:S'))} (model-written, {fmt(len(sit.get('by_language', {})))} languages)"],
        ["Training examples", fmt(rep.get("train_examples"))],
        ["Tokens (loss tokens)", f"{fmt(tok)} ({fmt(loss_tok)})"],
        ["Length p50 / p90 / max", f"{fmt(lens[0])} / {fmt(lens[1])} / {fmt(lens[2])}"],
        ["Validation examples", fmt(rep.get("val_examples"))],
        r"\midrule \multicolumn{2}{l}{\emph{Outcome}} \\",
        ["Final validation loss", macros["SftValLoss"]],
        ["Task evaluation (gym)", r"\emph{not run}"],
    ]
    srcs = ", ".join(r"\nolinkurl{" + p.name + "}" for p in used)
    t1 = compact("tab:sft", f"Supervised fine-tuning of the released adapter \\nolinkurl{{{SFT_REPO}}}.", head, rows,
                 r">{\raggedright\arraybackslash}p{0.37\linewidth}>{\raggedright\arraybackslash}p{0.55\linewidth}",
                 note=f"All values are read from the published artifacts ({srcs}). Loss on assistant and tool-call tokens only.")
    sweep = rep.get("tool_limit_search") or {}
    srows = []
    for lim in sorted(sweep, key=lambda x: -int(x)):
        s = sweep[lim]
        srows.append([fmt(int(lim)), f"{100 * s.get('fit_frac', 0):.1f}", fmt(s.get("p50")), fmt(s.get("p90")), fmt(s.get("max"))])
    if sweep:
        lo, hi = min(sweep, key=int), max(sweep, key=int)
        lo_fit = sweep[lo].get("fit_frac")
        plateau = max(int(k) for k, v in sweep.items() if v.get("fit_frac") == lo_fit)
        macros["SweepPlateau"] = fmt(plateau)
        macros.update(SweepFitHi=f"{100 * sweep[hi]['fit_frac']:.1f}\\%", SweepFitLo=f"{100 * sweep[lo]['fit_frac']:.1f}\\%",
                      SweepLimHi=fmt(int(hi)), SweepLimLo=fmt(int(lo)),
                      SweepMedHi=fmt(sweep[hi].get("p50")), SweepMedLo=fmt(sweep[lo].get("p50")),
                      SweepPNinetyLo=fmt(sweep[lo].get("p90")))
    t2 = compact("tab:toollimit", "Tool-output truncation limit versus the share of sampled training dialogues that fit "
                 f"the {fmt(rep.get('maxlen'))}-token context, with dialogue length in tokens.",
                 ["Limit (chars)", "Fit (\\%)", "p50", "p90", "Max"], srows, "rrrrr",
                 note=f"Source: \\nolinkurl{{{SFT_REPORT.name}}} (sha256 {sha12(SFT_REPORT)}).")
    return t1, t2, used


T1_COLS = [  # (metric key, header, higher is better)
    ("reward", r"$R$", True), ("f1_benefits", r"F1$_\text{ben}$", True), ("acc_office", r"Acc$_\text{off}$", True),
    ("f1_documents", r"F1$_\text{doc}$", True), ("cite_valid", "Cite", True), ("next_step_correct", "Next", True),
    ("excess_questions_median", r"$\tilde{q}_{\text{exc}}$", False), ("boundary_violations", "Viol.", False),
    ("pass^1", r"pass$^1$", True),
]


def t1_table(results: list[tuple[Path, object]], macros: dict[str, str]) -> tuple[str, list[Path]]:
    """T1 from ml/results/t1-*.json written by ml/eval/run.py (system, config.mode, metrics.overall)."""
    files = [(p, d) for p, d in results if p.name.startswith("t1-") and isinstance(d, dict)
             and isinstance(d.get("metrics"), dict) and isinstance(d["metrics"].get("overall"), dict)]
    label = "tab:t1"
    caption = ("Agents in the AT-Benefits gym (T1) on the same test personas and simulated user. "
               "Engine: the product's tools; no engine: plan submission only. Best value per column in bold.")
    head = ["System", "Tools", "$n$"] + [h for _, h, _ in T1_COLS]
    if not files:
        macros.update(TOneN="0", TOneSentence="Frontier-model baselines in the gym (T1) were still running when this "
                      "version was built and are reported as pending.")
        row = [r"\emph{pending}"] + [""] * (len(head) - 1)
        return compact(label, caption, head, [row], "ll" + "r" * (len(head) - 2), star=True, size=r"\footnotesize",
                       note="No T1 result file existed when the paper was built."), []
    recs = []
    for p, d in files:
        m = d["metrics"]["overall"]
        mode = (d.get("config") or {}).get("mode") or ("engine" if "(engine)" in str(d.get("system")) else "no-engine")
        name = re.sub(r"\s*\((?:no-)?engine\)\s*$", "", str(d.get("system") or p.stem))
        recs.append({"path": p, "name": name, "mode": mode, "m": m, "errors": len(d.get("errors") or [])})
    recs.sort(key=lambda r: (r["mode"] != "no-engine", r["name"]))
    best: dict[str, float] = {}
    for key, _, hib in T1_COLS:
        vals = [r["m"].get(key) for r in recs if isinstance(r["m"].get(key), (int, float))]
        if len(vals) >= 2:
            best[key] = max(vals) if hib else min(vals)
    rows = []
    for r in recs:
        cells = [tex(r["name"]), "engine" if r["mode"] == "engine" else "no engine", fmt(r["m"].get("n"))]
        for key, _, _ in T1_COLS:
            v = r["m"].get(key)
            s = (fmt(v) if key == "boundary_violations" else f3(v)) if isinstance(v, (int, float)) else "--"
            if key in best and isinstance(v, (int, float)) and abs(v - best[key]) < 1e-12:
                s = r"\textbf{" + s + "}"
            cells.append(s)
        rows.append(cells)
    top = max(recs, key=lambda r: r["m"].get("reward") if isinstance(r["m"].get("reward"), (int, float)) else -9)
    ci = top["m"].get("reward_ci95") or [None, None]
    errs = sum(r["errors"] for r in recs)
    macros.update(TOneN=fmt(len(recs)), TOneBestR=f3(top["m"].get("reward")), TOneBestPass=f3(top["m"].get("pass^1")),
                  TOneErrors=fmt(errs),
                  TOneSentence=(f"In the gym, the best of {fmt(len(recs))} evaluated agent configurations "
                                f"({tex(top['name'])}, {'engine tools' if top['mode'] == 'engine' else 'no engine tools'}) "
                                f"reaches mean reward {f3(top['m'].get('reward'))} "
                                f"(95\\% CI {f3(ci[0])}--{f3(ci[1])}) and pass$^1$ {f3(top['m'].get('pass^1'))}."))
    note = (r"Means over episodes; $\tilde{q}_{\text{exc}}$: median excess questions over the engine minimum; "
            f"Viol.: boundary violations (count). {fmt(errs)} episodes ended in an API or tool error and are excluded. "
            "Sources: " + "; ".join(r"\nolinkurl{" + r["path"].name + "}" for r in recs) + ".")
    return compact(label, caption, head, rows, "ll" + "r" * (len(head) - 2), note=note, star=True,
                   size=r"\footnotesize"), [r["path"] for r in recs]


REWARD_PY = ROOT / "ml" / "gym" / "reward.py"


def success_threshold(macros: dict[str, str]) -> None:
    src = ROOT / "ml" / "gym" / "metrics.py"
    if src.is_file():
        m = re.search(r"^SUCCESS_THRESHOLD\s*=\s*([0-9.]+)", src.read_text(encoding="utf-8"), re.M)
        if m:
            macros["SuccessThreshold"] = m.group(1)


def reward_weights(macros: dict[str, str]) -> None:
    """Weights of the gym reward, read from the module constants of ml/gym/reward.py."""
    if not REWARD_PY.is_file():
        return
    src = REWARD_PY.read_text(encoding="utf-8")
    names = {"W_BENEFITS": "RwBen", "W_OFFICE": "RwOff", "W_DOCUMENTS": "RwDoc", "W_CITE": "RwCite",
             "W_NEXT": "RwNext", "P_QUESTION": "RwQ", "P_BOUNDARY": "RwBound", "P_UNCITED": "RwUncited",
             "P_MALFORMED": "RwMalformed", "SHAPE_FILL": "RwShapeFill", "SHAPE_KNOWN": "RwShapeKnown"}
    for const, macro in names.items():
        m = re.search(rf"^{const}\s*=\s*(-?[0-9.]+)", src, re.M)
        if m:
            v = float(m.group(1))
            macros[macro] = f"{abs(v):.2f}" if macro != "RwBound" else f"{abs(v):.1f}"


# ---------------------------------------------------------------- numbers for the prose


def product_numbers(macros: dict[str, str]) -> None:
    """Headline numbers of the product suites, parsed from docs/evals/results.md."""
    if not EVALS_MD.is_file():
        return
    md = EVALS_MD.read_text(encoding="utf-8")
    m = re.search(r"Latest full run: \*\*(\d+)/(\d+) passed; (\d+) violations", md)
    if m:
        macros.update(EvalEFivePassed=m.group(1), EvalEFiveCases=m.group(2), EvalEFiveViolations=m.group(3))
    suites = {clean_md(r[0]): clean_md(r[2]) for r in md_table_after(md, "| Suite | Observations | Measured result")
              if len(r) >= 3 and "superseded" not in r[0].lower()}

    def find(prefix: str, pattern: str) -> re.Match | None:
        for name, val in suites.items():
            if name.startswith(prefix):
                return re.search(pattern, val)
        return None

    if (m := find("E1 ", r"(\d+)/(\d+) passed")):
        macros.update(EvalEOne=f"{m.group(1)}/{m.group(2)}")
    if (m := find("E3 ", r"Recall@10 ([0-9.]+)%.*?nDCG@10 ([0-9.]+)")):
        macros.update(EvalEThreeRecall=m.group(1) + r"\%", EvalEThreeNdcg=m.group(2))
    if (m := find("E7 ", r"Exact ([0-9.]+)% \((\d+)/(\d+)\)")):
        macros.update(EvalESeven=f"{m.group(2)}/{m.group(3)}")
    if (m := find("E11 ", r"(\d+)/(\d+) exact slot maps, ([0-9.]+)%")):
        macros.update(EvalEEleven=m.group(3) + r"\%")
    if (m := find("E12 ", r"Precision ([0-9.]+)%.*?recall ([0-9.]+)%")):
        macros.update(EvalETwelveP=m.group(1) + r"\%", EvalETwelveR=m.group(2) + r"\%")
    if (m := find("E13 ", r"Recall ([0-9.]+)%.*?precision ([0-9.]+)%")):
        macros.update(EvalEThirteenR=m.group(1) + r"\%", EvalEThirteenP=m.group(2) + r"\%")
    if (m := re.search(r"precision remains below (\d+)%", md)):
        macros.update(EvalEThirteenTarget=m.group(1) + r"\%")
    judged = succ = 0
    for r in md_table_after(md, "| Batch | Judged / attempted | Verified task successes"):
        if len(r) < 3:
            continue
        j = re.match(r"(\d+)/\d+", r[1])
        s = re.match(r"(\d+)/\d+", r[2])
        if j and s:
            judged += int(j.group(1))
            succ += int(s.group(1))
    if judged:
        macros.update(EvalEFourSuccesses=str(succ), EvalEFourJudged=str(judged))


def quantum_numbers(data: dict, macros: dict[str, str]) -> None:
    """Headline numbers of the quantum study for the appendix text."""
    runs = dig(data, "aer", "runs") or []
    if runs:
        secs = [s for s in (dig(r, "baselines", "cpsat", "seconds") for r in runs) if isinstance(s, (int, float))]
        optimal = all(dig(r, "baselines", "cpsat", "status") == "OPTIMAL" for r in runs)
        macros.update(QInstances=fmt(len(runs)), QCpsatStatus="optimal" if optimal else "not always optimal")
        if secs:
            macros.update(QCpsatMaxMs=f"{max(secs) * 1000:.0f}")
    hw = data.get("hardware")
    if isinstance(hw, dict) and hw.get("status") == "done":
        circ = hw.get("circuits") or []
        names = list(dict.fromkeys(c.get("name") for c in circ))
        kinds = {c.get("name"): (c.get("kind"), c.get("qubits")) for c in circ}
        qa = [n for n in names if kinds[n][0] == "Q-A"]
        qb = [n for n in names if kinds[n][0] == "Q-B"]

        def reached(variant: str) -> list[str]:
            return [c.get("name") for c in circ if c.get("variant") == variant and c.get("approx_ratio_best") == 1]

        def qubits(ns: list[str]) -> str:
            qs = list(dict.fromkeys(str(kinds[n][1]) for n in ns))
            return qs[0] if len(qs) == 1 else "/".join(qs)

        plain = reached("qaoa")
        warm = reached("warm-start")
        macros.update(QHwBackend=tex(hw.get("backend")), QHwInstances=fmt(len(names)), QHwShots=fmt(hw.get("shots")),
                      QHwQA=fmt(len(qa)), QHwQAQubits=qubits(qa) if qa else "--",
                      QHwQB=fmt(len(qb)), QHwQBQubits=qubits(qb) if qb else "--",
                      QHwPlainOpt=fmt(len(plain)), QHwWarmOpt=fmt(len(warm)),
                      QHwPlainOptWhich=("the set-cover (Q-B) instances" if plain and all(kinds[n][0] == "Q-B" for n in plain)
                                        else "a subset of the instances"))


# ---------------------------------------------------------------- main


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    results = load_results()
    used: list[Path] = []

    groups = {
        "personas": (("persona",), ("publish",)),
        "corpus": (("corpus",), ("publish",)),
        "release": (("publish",), ()),
        "selftest": (("selftest", "self_test", "gym"), ()),
        "sft": (("sft",), ()),
    }
    found: dict[str, list] = {}
    generic = [(p, d) for p, d in results if not p.name.startswith(("t1-", "sft-qwen3-8b-"))]
    for g, (inc, exc) in groups.items():
        found[g] = pick(generic, inc, exc)
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

    macros: dict[str, str] = {}
    write("tab_personas.tex", persona_compact(found["personas"], macros))
    write("tab_corpus.tex", corpus_compact(found["corpus"], macros))
    write("tab_selftest.tex", selftest_compact(found["selftest"], macros))
    sft_tex, toollimit_tex, sft_used = sft_tables(macros)
    write("tab_sft.tex", sft_tex)
    write("tab_toollimit.tex", toollimit_tex)
    used += [p for p in sft_used if p not in used]
    t1_tex, t1_used = t1_table(results, macros)
    write("tab_t1.tex", t1_tex)
    used += [p for p in t1_used if p not in used]
    write("tab_world.tex", world_compact(macros))
    write("tab_e4.tex", e4_table())
    data_tex, data_used = data_release(results, macros)
    write("tab_data.tex", data_tex)
    used += [p for p in data_used if p not in used]
    stale = OUT / "tab_release.tex"  # superseded by tab_data.tex
    if stale.exists():
        stale.unlink()
    product_numbers(macros)
    reward_weights(macros)
    success_threshold(macros)

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
    if quantum and isinstance(quantum[0][1], dict):
        quantum_numbers(quantum[0][1], macros)

    _, have_product = product_table()
    write("tab_product.tex", product_compact())

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
    if any(p.name.startswith("datagen-") for p in used):
        have.append("the dataset generators")
    if found["sft"]:
        have.append("an SFT smoke run")
    if SFT_REPORT in used:
        have.append("the Qwen3-8B SFT run")
    if quantum:
        have.append("the quantum study")
    trained = any(t in measured_tables for t in ("T1", "T2", "T3"))

    def join(xs: list[str]) -> str:
        return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]

    if have:
        research = f"Result files from the research lane exist for {join(have)}; their tables are generated from those files."
    else:
        research = "No result files from the research lane existed when this version was built; every research table reads \\emph{not run}."
    if SFT_REPORT in used and not trained:
        agents = ("One open model, Qwen3-8B with a LoRA adapter, has been fine-tuned on the released dialogues "
                  "(Table~\\ref{tab:sft}); its task performance in the gym has not been evaluated, and GRPO and DPO "
                  "have not been run.")
    elif found["sft"] and not trained:
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
    write("numbers.tex", "% generated by scripts/tables.py: numbers quoted in the prose\n"
          + "".join(f"\\newcommand{{\\{k}}}{{{v}}}\n" for k, v in sorted(macros.items())))
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
