"""Scan simulation (rotation, blur, noise, contrast, JPEG, 150 DPI) and Tesseract OCR.

The clean page is rasterised from the PDF with pdfium, degraded with seeded parameters and stored
as an 8-bit grayscale PNG. Gold boxes are mapped through the same rotation, so `scan_bbox` is the
axis-aligned box of the rotated quote box in the PNG (normalised, top-left origin). OCR uses
Tesseract with `deu` when available (`TESSDATA_PREFIX` may point at a local `deu.traineddata`);
without it only the text layer is stored and `ocr.available` is false.
"""

from __future__ import annotations

import io
import math
import os
import random
import re
import shutil
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageEnhance, ImageFilter

DPI = 150
LOCAL_TESSDATA = Path(__file__).resolve().parents[2] / "data" / "datagen" / "tessdata"


def params(seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    quality = rng.choice(["good", "good", "medium", "poor"])
    return {
        "dpi": DPI,
        "quality": quality,
        "angle": round(rng.uniform(-2.5, 2.5) if quality != "good" else rng.uniform(-0.8, 0.8), 2),
        "blur": round(
            {"good": 0.3, "medium": 0.7, "poor": 1.1}[quality] * rng.uniform(0.6, 1.2), 2
        ),
        "noise": round(
            {"good": 3.0, "medium": 7.0, "poor": 12.0}[quality] * rng.uniform(0.6, 1.2), 1
        ),
        "contrast": round(rng.uniform(0.75, 1.05), 2),
        "brightness": round(rng.uniform(0.95, 1.08), 2),
        "jpeg": rng.choice([40, 55, 70, 85]),
        "seed": seed,
    }


def _rotate_box(box: dict[str, float], w: int, h: int, angle_deg: float) -> dict[str, float]:
    """PIL rotates counter-clockwise around the centre (expand=False); map the box corners."""
    a = math.radians(angle_deg)
    cx, cy = w / 2, h / 2
    xs, ys = [], []
    for fx in (box["x"], box["x"] + box["width"]):
        for fy in (box["y"], box["y"] + box["height"]):
            x, y = fx * w - cx, fy * h - cy
            # image coordinates have y down: counter-clockwise rotation by a on screen
            xr = x * math.cos(a) + y * math.sin(a)
            yr = -x * math.sin(a) + y * math.cos(a)
            xs.append(xr + cx)
            ys.append(yr + cy)
    x0, x1 = max(0.0, min(xs)), min(float(w), max(xs))
    y0, y1 = max(0.0, min(ys)), min(float(h), max(ys))
    return {
        "x": round(x0 / w, 6),
        "y": round(y0 / h, 6),
        "width": round((x1 - x0) / w, 6),
        "height": round((y1 - y0) / h, 6),
    }


def simulate(pdf: bytes, p: dict[str, Any]) -> list[bytes]:
    doc = pdfium.PdfDocument(pdf)
    rng = np.random.default_rng(p["seed"])
    out = []
    try:
        for i in range(len(doc)):
            page = doc[i]
            img = page.render(scale=p["dpi"] / 72, grayscale=True).to_pil().convert("L")
            page.close()
            img = img.rotate(p["angle"], resample=Image.BICUBIC, expand=False, fillcolor=255)
            img = img.filter(ImageFilter.GaussianBlur(p["blur"]))
            img = ImageEnhance.Contrast(img).enhance(p["contrast"])
            img = ImageEnhance.Brightness(img).enhance(p["brightness"])
            arr = np.asarray(img, dtype=np.float32)
            arr = arr + rng.normal(0, p["noise"], arr.shape)
            img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "L")
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=p["jpeg"])
            img = Image.open(io.BytesIO(buf.getvalue())).convert("L")
            png = io.BytesIO()
            img.save(png, "PNG", optimize=True)
            out.append(png.getvalue())
    finally:
        doc.close()
    return out


def map_boxes(
    statements: list[dict[str, Any]], p: dict[str, Any], size: tuple[int, int]
) -> dict[str, dict]:
    w, h = size
    return {s["id"]: _rotate_box(s["bbox"], w, h, p["angle"]) for s in statements}


@lru_cache(maxsize=1)
def tesseract() -> tuple[str | None, dict[str, str]]:
    exe = shutil.which("tesseract")
    if not exe:
        return None, {}
    env = dict(os.environ)
    for prefix in [env.get("TESSDATA_PREFIX"), str(LOCAL_TESSDATA), None]:
        if prefix:
            env["TESSDATA_PREFIX"] = prefix
        elif "TESSDATA_PREFIX" in env and prefix is None:
            env.pop("TESSDATA_PREFIX")
        try:
            langs = subprocess.run(
                [exe, "--list-langs"], env=env, capture_output=True, text=True, timeout=20
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if re.search(r"^deu$", langs.stdout + langs.stderr, re.M):
            return exe, env
    return None, {}


def ocr(pngs: list[bytes]) -> dict[str, Any]:
    exe, env = tesseract()
    if not exe:
        return {"available": False, "engine": None, "pages": []}
    pages = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, png in enumerate(pngs):
            path = Path(tmp) / f"p{i}.png"
            path.write_bytes(png)
            res = subprocess.run(
                [
                    exe,
                    str(path),
                    "stdout",
                    "-l",
                    "deu",
                    "--psm",
                    "4",
                    "--dpi",
                    str(DPI),
                    "-c",
                    "tessedit_create_tsv=1",
                ],
                env=env | {"OMP_THREAD_LIMIT": "1"},
                capture_output=True,
                text=True,
                timeout=120,
            )
            words, confs, lines = [], [], {}
            for row in res.stdout.splitlines()[1:]:
                cols = row.split("\t")
                if len(cols) < 12 or not cols[11].strip():
                    continue
                try:
                    conf = float(cols[10])
                except ValueError:
                    continue
                key = (int(cols[2]), int(cols[3]), int(cols[4]))
                lines.setdefault(key, []).append(cols[11])
                words.append(cols[11])
                if conf >= 0:
                    confs.append(conf)
            text = "\n".join(" ".join(ws) for _, ws in sorted(lines.items()))
            pages.append(
                {
                    "page": i + 1,
                    "text": text,
                    "mean_conf": round(float(np.mean(confs)), 2) if confs else None,
                    "words": len(words),
                }
            )
    return {"available": True, "engine": "tesseract-deu-fast", "pages": pages}


_WS = re.compile(r"\s+")


def quote_recall(statements: list[dict[str, Any]], ocr_result: dict[str, Any]) -> float | None:
    if not ocr_result.get("available") or not statements:
        return None
    texts = [_WS.sub(" ", p["text"]) for p in ocr_result["pages"]]
    hits = 0
    for s in statements:
        q = _WS.sub(" ", s["quote"]).strip()
        if s["page"] - 1 < len(texts) and q in texts[s["page"] - 1]:
            hits += 1
    return round(hits / len(statements), 4)


def png_size(png: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(png)) as im:
        return im.size
