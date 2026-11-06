"""AT-Benefits `forms` family: filled official forms with field-level and detection gold.

    uv run python -m datagen.forms.run [--per-template 600] [--pdf-budget-gb 1.5] [--workers 8]

Resumable: work is cut into shards (template x chunk); each finished shard leaves its JSONL files
and a `.done` marker, so a rerun skips it. No LLM is needed. The optional judge pass
(`--judge-sample N`) is budget-aware and only runs when the datagen key check passes.

Outputs under `ml/data/datagen/forms/` (git-ignored):
    templates.jsonl                 normalized schema, widget geometry, licence per template
    instances/<template>.<k>.jsonl  one record per (template, persona): facts + field gold
    detection/<template>.<k>.jsonl  one record per rendered flat or scanned PDF: boxes + labels
    pdf/<template>/<instance>.{filled,flat,scan}.pdf
    metrics.json  (also copied to ml/results/datagen-forms-<sha>.json)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import subprocess
import sys
import tempfile
import time
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from datagen import io
from datagen.forms import release, scan
from datagen.forms.identity import NS, build_facts, valid_iban, valid_svnr
from datagen.forms.templates import REPO, Template, all_templates

ML = REPO / "ml"
BRIDGE = Path(__file__).with_name("brain_fill.ts")
SPLITS = ("train", "val", "test", "heldout_family")
CHUNK = 50


def out_root() -> Path:
    env = os.environ.get("DATAGEN_FORMS_OUT")
    return Path(env) if env else io.family_dir("forms")


def personas_dir() -> Path:
    env = os.environ.get("DATAGEN_PERSONAS_DIR")
    return Path(env) if env else ML / "data/personas"


def git_sha() -> str:
    return io.git_sha()


# ---------------------------------------------------------------- personas


def load_personas(directory: Path) -> list[dict]:
    rows = []
    for split in SPLITS:
        path = directory / f"{split}.parquet"
        if not path.exists():
            continue
        frame = pd.read_parquet(path, columns=["id", "split", "household"])
        for pid, sp, hh in frame.itertuples(index=False):
            rows.append({"id": pid, "split": sp, "household": json.loads(hh)})
    if not rows:
        raise FileNotFoundError(f"no persona parquet files in {directory}")
    return rows


def affinity(template: Template, persona: dict) -> float:
    """How plausible this form is for the persona (sampling weight, never a filter)."""
    s = next(m for m in persona["household"] if m["role"] == "subject")
    tags = " ".join(template.tags) + " " + template.ref
    w = 1.0
    vienna = s["residence"]["state"] == "Wien"
    care = bool(s.get("care", {}).get("pflegegeld_level"))
    if "fsw" in tags or "fahrtkosten-wien" in tags:
        w *= 6.0 if vienna else 0.3
    if "pflegegeld" in tags or "senioren" in tags or "einrichtungswunsch" in tags:
        w *= 4.0 if care or s["age"] >= 70 else 0.5
    if "svbox-kur-reha" in tags:
        w *= 2.0 if 30 <= s["age"] <= 75 else 0.7
    if "carrier:SVS" in tags:
        farmer = s["employment"] == "farmer"
        svs = s["insurance"].get("carrier") == "svs"
        w *= 6.0 if farmer else 3.0 if svs else 0.4
    return w


def sample_personas(template: Template, personas: list[dict], n: int, seed: int) -> list[dict]:
    rng = random.Random(f"{template.ref}:{seed}")
    # Efraimidis-Spirakis weighted sampling without replacement.
    keyed = []
    for p in personas:
        w = affinity(template, p)
        keyed.append((rng.random() ** (1.0 / w), p["id"], p))
    keyed.sort(reverse=True)
    return [p for _, _, p in keyed[: min(n, len(keyed))]]


# ---------------------------------------------------------------- bridge


def run_bridge(
    templates: dict[str, Template], jobs: list[dict], describe: list[str] = ()
) -> list[dict]:
    spec = {
        "templates": {u: t.bridge_spec() for u, t in templates.items()},
        "jobs": jobs,
        "describe": list(describe),
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(spec, fh, ensure_ascii=False, default=str)
        path = fh.name
    try:
        proc = subprocess.run(["bun", str(BRIDGE), path], capture_output=True, text=True, cwd=REPO)
    finally:
        os.unlink(path)
    if proc.returncode != 0:
        raise RuntimeError(f"brain bridge failed: {proc.stderr[-2000:]}")
    return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]


def describe_templates(templates: list[Template]) -> dict[str, dict]:
    rows = run_bridge({t.uuid: t for t in templates}, [], [t.uuid for t in templates])
    return {r["template"]: r for r in rows if r["kind"] == "describe"}


# ---------------------------------------------------------------- gold


def writable(field: dict) -> bool:
    return (
        field["owner"] == "applicant"
        and field["signature"] == "none"
        and field["type"] != "signature"
    )


def field_boxes(field: dict, widgets: dict) -> list[dict]:
    if field.get("box"):
        b = field["box"]
        return [
            {
                "page": b["page"],
                "x": b["x"],
                "y": b["y"],
                "width": b["width"],
                "height": b["height"],
            }
        ]
    return widgets.get(field.get("acro_field") or "", [])


def missing_reason(field: dict, facts: list[dict], template_uuid: str) -> str:
    """Why a writable field stays empty (explanatory label; the decision is the brain's)."""
    ftype = field.get("fact_type") or f"form.field.{template_uuid}.{field['id']}"
    if ftype.startswith("form.field."):
        return "unmapped"
    rows = [f for f in facts if f["type"] == ftype]
    confirmed = [f for f in rows if f["confirmed"]]
    if not rows:
        return "no_fact"
    if not confirmed:
        return "unconfirmed_only"
    if "iban" in ftype and all(f["source"]["kind"] == "document" for f in confirmed):
        return "iban_not_stated"
    if len({json.dumps(f["value"]) for f in confirmed}) > 1:
        return "ambiguous"
    return "invalid_value"


def build_instance(
    t: Template,
    desc: dict,
    persona: dict,
    identity: dict,
    facts: list[dict],
    noise: dict,
    result: dict,
    pdfs: dict,
) -> dict:
    props = {p["fieldId"]: p for p in result["proposals"]}
    original = {f["id"]: f for f in t.fields}
    fields = []
    counts: Counter = Counter()
    for f in desc["fields"]:
        src = original.get(f["id"], {})
        if f["owner"] != "applicant":
            status = f"provider_{f['owner']}"
        elif f["signature"] != "none" or f["type"] == "signature":
            status = "signature"
        elif f["id"] in props:
            status = "filled"
        else:
            status = "missing:" + missing_reason(f, facts, t.uuid)
        counts[status.split(":")[0]] += 1
        p = props.get(f["id"])
        mapping = (
            "unmapped"
            if (f.get("fact_type") or "").startswith("form.field.")
            else ("candidate" if t.source == "e13" else "catalog")
        )
        fields.append(
            {
                "field_id": f["id"],
                "label_de": f["label_de"],
                "type": f["type"],
                "owner": f["owner"],
                "owner_propagated": src.get("owner", f["owner"]) != f["owner"],
                "section": src.get("help_text") if t.source == "e13" else None,
                "page": f["page"],
                "acro_field": f.get("acro_field"),
                "boxes": field_boxes(f, desc["widgets"]),
                "required": bool((f.get("validation") or {}).get("required")),
                "validation": f.get("validation") or {},
                "signature_required": f["type"] == "signature" or f["signature"] == "subject",
                "fact_type": f.get("fact_type"),
                "mapping": mapping,
                "status": status,
                "value": p["value"] if p else None,
                "provenance": p["provenance"] if p else None,
            }
        )
    subject = next(m for m in persona["household"] if m["role"] == "subject")
    return {
        "id": f"{t.ref}:{persona['id']}",
        "template_ref": t.ref,
        "template_id": t.uuid,
        "template_title": t.title,
        "template_format": t.format,
        "template_source": t.source,
        "template_sha256": t.sha256,
        "publisher": t.publisher,
        "persona_id": persona["id"],
        "split": persona["split"],
        "persona": {
            "age": subject["age"],
            "sex": subject["sex"],
            "state": subject["residence"]["state"],
            "carrier": subject["insurance"].get("carrier"),
            "employment": subject["employment"],
            "care_level": subject.get("care", {}).get("pflegegeld_level"),
            "has_helper": any(m["role"] == "helper" for m in persona["household"]),
            "name_origin": identity["origin"],
        },
        "facts": facts,
        "noise": noise,
        "fields": fields,
        "missing_fields": result["missingFields"],
        "counts": dict(counts),
        "signature_fields": [f["field_id"] for f in fields if f["signature_required"]],
        "requires_handwritten_signature": any(f["signature_required"] for f in fields),
        "pdf": pdfs,
        "render_error": result.get("renderError"),
        "attribution": t.attribution,
        "terms": t.terms,
        "pdf_redistributable": t.redistribute_pdf,
    }


def detection_record(
    t: Template, desc: dict, inst: dict, kind: str, path: str, scan_meta: dict | None
) -> dict:
    boxes = []
    for f in inst["fields"]:
        for b in f["boxes"]:
            box = b
            if scan_meta:
                size = scan_meta["page_sizes"][b["page"] - 1]
                box = scan.rotate_box(
                    b, scan_meta["angles"][b["page"] - 1], size["width"], size["height"]
                )
            boxes.append(
                {
                    "field_id": f["field_id"],
                    "box": box,
                    "label_de": f["label_de"],
                    "type": f["type"],
                    "owner": f["owner"],
                    "section": f["section"],
                    "value": f["value"] if f["status"] == "filled" else None,
                }
            )
    return {
        "id": f"{inst['id']}:{kind}",
        "instance_id": inst["id"],
        "template_ref": t.ref,
        "kind": kind,  # "flat" (vector, flattened) or "scan" (image-only)
        "pdf": path,
        "split": inst["split"],
        "pages": desc["pages"],
        "coordinates": "PDF points, displayed CropBox, origin top-left, one-based pages",
        "scan": scan_meta,
        "boxes": boxes,
        "attribution": t.attribution,
        "pdf_redistributable": t.redistribute_pdf,
    }


# ---------------------------------------------------------------- shards


def render_plan(
    templates: list[Template], per_template: int, budget_bytes: int, scan_share: float
) -> dict:
    """Renders per template so that each template gets an equal share of the PDF budget."""
    # Templates whose PDFs may be redistributed get twice the share of local-only ones.
    weights = {t.ref: 2.0 if t.redistribute_pdf else 1.0 for t in templates}
    total = sum(weights.values()) or 1.0
    plan = {}
    for t in templates:
        share = budget_bytes * weights[t.ref] / total
        size = t.pdf.stat().st_size
        # AcroForm: filled always + flat for half; flat originals: flat always + filled for a
        # third. A simulated scan costs about 250 kB per page.
        vector = size * (1.5 if t.format == "acroform" else 1.34)
        per_render = vector + scan_share * (0.5 if t.format == "acroform" else 1) * (
            t.pages * 250_000
        )
        plan[t.ref] = max(10, min(per_template, int(share / per_render)))
    return plan


def shard_jobs(
    t: Template, chunk: list[dict], k: int, renders: int, root: Path, scan_share: float, seed: int
) -> tuple[list[dict], dict]:
    jobs, meta = [], {}
    pdf_dir = root / "pdf" / t.ref
    pdf_dir.mkdir(parents=True, exist_ok=True)
    for j, persona in enumerate(chunk):
        index = k * CHUNK + j
        identity, facts, noise = build_facts(persona, seed)
        render = {}
        pdfs = {}
        stem = persona["id"]
        if index < renders:
            # Flat originals: the flattened output is the main artifact (detection), the
            # AcroForm output for a third. AcroForm originals: filled always, flat for half.
            want_filled = t.format == "acroform" or index % 3 == 0
            want_flat = t.format == "flat" or index % 2 == 0
            if want_filled:
                render["filled"] = str(pdf_dir / f"{stem}.filled.pdf")
                pdfs["filled"] = f"pdf/{t.ref}/{stem}.filled.pdf"
            if want_flat:
                render["flat"] = str(pdf_dir / f"{stem}.flat.pdf")
                pdfs["flat"] = f"pdf/{t.ref}/{stem}.flat.pdf"
            h = int(hashlib.sha256(f"scan:{t.ref}:{stem}".encode()).hexdigest()[:8], 16)
            if want_flat and h / 2**32 < scan_share:
                pdfs["scan"] = f"pdf/{t.ref}/{stem}.scan.pdf"
        job = {
            "id": f"{t.ref}:{persona['id']}",
            "template": t.uuid,
            "facts": facts,
            "render": render,
            "approvalId": str(uuid.uuid5(NS, f"approval:{t.ref}:{persona['id']}")),
        }
        jobs.append(job)
        meta[job["id"]] = (persona, identity, facts, noise, pdfs)
    return jobs, meta


def run_shard(
    t: Template,
    desc: dict,
    chunk: list[dict],
    k: int,
    renders: int,
    root: Path,
    scan_share: float,
    seed: int,
) -> dict:
    name = f"{t.ref}.{k:03d}"
    done = root / "state" / f"{name}.done"
    if done.exists():
        return json.loads(done.read_text())
    jobs, meta = shard_jobs(t, chunk, k, renders, root, scan_share, seed)
    results = run_bridge({t.uuid: t}, jobs)
    instances, detections, errors = [], [], []
    for r in results:
        if r.get("error"):
            errors.append({"id": r["id"], "error": r["error"]})
            continue
        persona, identity, facts, noise, pdfs = meta[r["id"]]
        if r.get("renderError"):
            pdfs = {}
        inst = build_instance(t, desc, persona, identity, facts, noise, r, pdfs)
        if "scan" in pdfs:
            scan_meta = scan.simulate(
                root / pdfs["flat"], root / pdfs["scan"], desc["pages"], seed=f"{inst['id']}:{seed}"
            )
            detections.append(detection_record(t, desc, inst, "scan", pdfs["scan"], scan_meta))
        if "flat" in pdfs:
            detections.append(detection_record(t, desc, inst, "flat", pdfs["flat"], None))
        instances.append(inst)
    for sub, rows in (("instances", instances), ("detection", detections)):
        path = root / sub / f"{name}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with tmp.open("w") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
        tmp.replace(path)
    summary = {
        "shard": name,
        "instances": len(instances),
        "detections": len(detections),
        "errors": errors,
    }
    done.parent.mkdir(parents=True, exist_ok=True)
    done.write_text(json.dumps(summary))
    return summary


# ---------------------------------------------------------------- e7 parity check


def e7_parity(templates: list[Template]) -> dict:
    """Run the E7 gold personas through the same bridge; compare with the E7 expected values.

    This proves the dataset's values come from the product's prefill policy: the agreement
    must match the product's own E7 result on the same inputs.
    """
    gold = json.loads((REPO / "packages/evals/sets/e7/gold.json").read_text())
    by_ref = {t.ref: t for t in templates}
    jobs, expected = [], {}
    for case in gold["cases"]:
        t = by_ref.get(case["input"]["form"])
        if not t:
            continue
        facts = []
        for n, f in enumerate(case["input"]["facts"]):
            fid = str(uuid.uuid5(NS, f"e7:{case['id']}:{n}"))
            doc = str(uuid.uuid5(NS, f"e7doc:{case['id']}")) if f["source"] == "document" else None
            turn = None if doc else str(uuid.uuid5(NS, f"e7turn:{case['id']}"))
            src = {"kind": f["source"], "quote": f["quote"]}
            src.update({"documentId": doc} if doc else {"turnId": turn})
            facts.append(
                {
                    "id": fid,
                    "type": f["type"],
                    "value": f["value"],
                    "confirmed": f["confirmed"],
                    "source": src,
                    "documentId": doc,
                    "turnId": turn,
                }
            )
        jobs.append({"id": case["id"], "template": t.uuid, "facts": facts})
        expected[case["id"]] = case["expected"]
    results = run_bridge({t.uuid: t for t in templates if t.source == "svbox"}, jobs)
    pos = pos_ok = blank = blank_ok = 0
    for r in results:
        got = {p["fieldId"]: p["value"] for p in r.get("proposals", [])}
        for fid, value in expected[r["id"]].items():
            if value is None:
                blank += 1
                blank_ok += fid not in got
            else:
                pos += 1
                pos_ok += got.get(fid) == value
    return {
        "cases": len(results),
        "expected_nonempty": pos,
        "nonempty_exact": pos_ok,
        "prefill_accuracy": round(pos_ok / pos, 4) if pos else None,
        "expected_blank": blank,
        "blank_correct": blank_ok,
    }


# ---------------------------------------------------------------- metrics


def compute_metrics(
    root: Path, templates: list[Template], plan: dict, parity: dict, elapsed: float
) -> dict:
    per_template: dict = defaultdict(Counter)
    status = Counter()
    split = Counter()
    origin = Counter()
    svnr_ok = iban_ok = svnr_n = iban_n = 0
    signatures = set()
    dup = 0
    det = Counter()
    det_boxes = 0
    render_errors: Counter = Counter()
    for path in sorted((root / "instances").glob("*.jsonl")):
        for line in path.open():
            r = json.loads(line)
            per_template[r["template_ref"]]["instances"] += 1
            split[r["split"]] += 1
            origin[r["persona"]["name_origin"]] += 1
            for f in r["fields"]:
                status[f["status"]] += 1
                per_template[r["template_ref"]][f["status"].split(":")[0]] += 1
                if f["status"] == "filled":
                    if f["fact_type"] == "person.insurance_number":
                        svnr_n += 1
                        svnr_ok += valid_svnr(str(f["value"]))
                    if f["fact_type"] == "bank.iban":
                        iban_n += 1
                        iban_ok += valid_iban(str(f["value"]))
            if r["render_error"]:
                render_errors[r["render_error"].split(" (")[0]] += 1
            if not any(f["status"] == "filled" for f in r["fields"]):
                continue  # all-empty instances (provider-only forms) are identical by design
            sig = hashlib.sha256(
                json.dumps(
                    [r["template_ref"]] + [[f["field_id"], f["value"]] for f in r["fields"]],
                    ensure_ascii=False,
                    default=str,
                ).encode()
            ).hexdigest()
            dup += sig in signatures
            signatures.add(sig)
    for path in sorted((root / "detection").glob("*.jsonl")):
        for line in path.open():
            r = json.loads(line)
            det[r["kind"]] += 1
            det_boxes += len(r["boxes"])
    pdf_bytes = sum(p.stat().st_size for p in (root / "pdf").rglob("*.pdf"))
    writable = sum(v for k, v in status.items() if k == "filled" or k.startswith("missing"))
    return {
        "family": "forms",
        "git_sha": git_sha(),
        "templates": len(templates),
        "templates_by_source": dict(Counter(t.source for t in templates)),
        "instances": sum(c["instances"] for c in per_template.values()),
        "instances_by_split": dict(split),
        "name_origin": dict(origin),
        "field_status": dict(status),
        "writable_fields": writable,
        "filled_share_of_writable": round(status["filled"] / writable, 4) if writable else None,
        "per_template": {k: dict(v) for k, v in sorted(per_template.items())},
        "render_plan": plan,
        "detection_records": dict(det),
        "detection_boxes": det_boxes,
        "pdf_bytes": pdf_bytes,
        "pdf_gb": round(pdf_bytes / 1e9, 3),
        "checks": {
            "svnr_valid": f"{svnr_ok}/{svnr_n}",
            "iban_valid": f"{iban_ok}/{iban_n}",
            "duplicate_value_signatures": dup,
            "render_errors": dict(render_errors),
            "e7_parity": parity,
        },
        "llm_tokens": 0,
        "cost_usd": 0.0,
        "elapsed_s": round(elapsed, 1),
    }


def judge_pass(root: Path, n: int, llm=None) -> dict:
    """Budget-aware LLM judge on a stratified sample; skipped unless the key check passes."""
    if llm is None:
        from datagen.check_key import check
        from datagen.llm import LLM

        ok, msg = check()
        for _ in range(10):  # 429 from a busy shared proxy is transient
            if ok or " 429 " not in f" {msg} ":
                break
            time.sleep(30)
            ok, msg = check()
        if not ok:
            return {"skipped": msg}
        llm = LLM("forms")
    from datagen.llm import BudgetExceeded

    try:
        out = release.run_judge(root, n, llm)
    except BudgetExceeded as e:
        return {"skipped": f"budget: {e}"}
    out["remaining"] = llm.remaining()
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--per-template", type=int, default=600)
    ap.add_argument("--pdf-budget-gb", type=float, default=1.5)
    ap.add_argument("--scan-share", type=float, default=0.2)
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 4) // 2))
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--templates", nargs="*", help="limit to these template refs")
    ap.add_argument("--personas-dir", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument(
        "--judge-sample",
        type=int,
        default=0,
        help="LLM-judge a stratified sample (needs datagen.check_key OK)",
    )
    ap.add_argument("--no-release", action="store_true", help="skip the Parquet release")
    ap.add_argument(
        "--include-local-pdfs",
        action="store_true",
        help="also embed PDFs whose terms do not permit redistribution",
    )
    args = ap.parse_args(argv)

    started = time.time()
    root = args.out or out_root()
    root.mkdir(parents=True, exist_ok=True)
    templates = all_templates()
    if args.templates:
        templates = [t for t in templates if t.ref in set(args.templates)]
    personas = load_personas(args.personas_dir or personas_dir())
    descs = describe_templates(templates)
    with (root / "templates.jsonl").open("w") as fh:
        for t in templates:
            d = descs[t.uuid]
            fh.write(
                json.dumps(
                    {
                        "template_ref": t.ref,
                        "template_id": t.uuid,
                        "source": t.source,
                        "title": t.title,
                        "publisher": t.publisher,
                        "url": t.url,
                        "format": t.format,
                        "sha256": t.sha256,
                        "pages": d["pages"],
                        "status": t.status,
                        "fields": d["fields"],
                        "widgets": d["widgets"],
                        "attribution": t.attribution,
                        "terms": t.terms,
                        "pdf_redistributable": t.redistribute_pdf,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    plan = render_plan(templates, args.per_template, int(args.pdf_budget_gb * 1e9), args.scan_share)
    tasks = []
    for t in templates:
        n = args.per_template
        if not any(writable(f) for f in descs[t.uuid]["fields"]):
            n = min(n, 60)  # provider-only forms: every instance is empty by design
        chosen = sample_personas(t, personas, n, args.seed)
        for k in range(0, len(chosen), CHUNK):
            tasks.append((t, chosen[k : k + CHUNK], k // CHUNK))
    print(
        f"forms: {len(templates)} templates, {len(tasks)} shards, workers={args.workers}",
        file=sys.stderr,
    )
    errors = 0
    with ThreadPoolExecutor(args.workers) as pool:
        futures = [
            pool.submit(
                run_shard, t, descs[t.uuid], chunk, k, plan[t.ref], root, args.scan_share, args.seed
            )
            for t, chunk, k in tasks
        ]
        for n, fut in enumerate(futures, 1):
            s = fut.result()
            errors += len(s["errors"])
            if n % 20 == 0 or n == len(futures):
                print(f"  {n}/{len(futures)} shards", file=sys.stderr)
    parity = e7_parity(all_templates())
    metrics = compute_metrics(root, templates, plan, parity, time.time() - started)
    metrics["bridge_errors"] = errors
    if not args.no_release and not args.out:
        rel = release.build_release(root, args.include_local_pdfs)
        metrics["release"] = rel
        io.write_card(
            "forms",
            release.CARD.format(
                templates=len(templates),
                instances=metrics["instances"],
                pdf_rows=rel["rows_with_pdf"],
                det=sum(metrics["detection_records"].values()),
                parity=f"{parity['nonempty_exact']}/{parity['expected_nonempty']} values, "
                f"{parity['blank_correct']}/{parity['expected_blank']} blanks",
            ),
        )
    # The release is on disk before the (slow, rate-limited) judge pass starts.
    if args.judge_sample:
        metrics["judge"] = judge_pass(root, args.judge_sample)
    (root / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False))
    if not args.out:
        _, results = io.write_metrics("forms", metrics)
        print(f"metrics: {results}", file=sys.stderr)
    print(
        json.dumps(
            {
                k: metrics[k]
                for k in ("instances", "detection_records", "pdf_gb", "filled_share_of_writable")
            }
        ),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
