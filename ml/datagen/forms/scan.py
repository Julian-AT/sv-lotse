"""Scan simulation for flat filled forms (field-detection training on scanned PDFs, FR-D11).

A flattened, filled PDF is rasterized with poppler (`pdftoppm`, grayscale), then degraded like
an office scanner or phone scan: small rotation (skew), uneven illumination, Gaussian noise,
slight blur and JPEG compression. The result is an image-only PDF with the original page size, so
gold boxes stay in PDF points (top-left origin). Boxes are transformed with the same rotation
and replaced by their axis-aligned bounding box.
"""

from __future__ import annotations

import math
import random
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def rasterize(pdf: Path, dpi: int, out_dir: Path) -> list[Path]:
    prefix = out_dir / "page"
    subprocess.run(
        ["pdftoppm", "-q", "-r", str(dpi), "-gray", str(pdf), str(prefix)],
        check=True,
        capture_output=True,
    )
    return sorted(out_dir.glob("page*.pgm"))


def degrade(img: Image.Image, rng: random.Random, angle: float) -> Image.Image:
    img = img.convert("L").rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=255)
    a = np.asarray(img, dtype=np.float32)
    h, w = a.shape
    # Uneven illumination: a soft gradient across the page.
    gx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    gy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    shade = 1.0 - rng.uniform(0.0, 0.12) * (
        rng.choice([gx, 1 - gx]) * 0.6 + rng.choice([gy, 1 - gy]) * 0.4
    )
    a = a * shade
    # Paper tone and contrast.
    a = a * rng.uniform(0.85, 1.0) + rng.uniform(0, 18)
    a += np.random.default_rng(rng.randrange(2**32)).normal(0, rng.uniform(2, 9), a.shape)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "L")
    if rng.random() < 0.6:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 0.9)))
    return img


def rotate_box(box: dict, angle: float, page_w: float, page_h: float) -> dict:
    """Rotate a top-left box counter-clockwise by `angle` degrees about the page centre."""
    cx, cy = page_w / 2, page_h / 2
    t = math.radians(angle)
    pts = []
    for x, y in (
        (box["x"], box["y"]),
        (box["x"] + box["width"], box["y"]),
        (box["x"], box["y"] + box["height"]),
        (box["x"] + box["width"], box["y"] + box["height"]),
    ):
        dx, dy = x - cx, y - cy
        # Image y points down, so a counter-clockwise image rotation uses this matrix.
        rx = cx + dx * math.cos(t) + dy * math.sin(t)
        ry = cy - dx * math.sin(t) + dy * math.cos(t)
        pts.append((rx, ry))
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, y0 = max(min(xs), 0.0), max(min(ys), 0.0)
    x1, y1 = min(max(xs), page_w), min(max(ys), page_h)
    return {
        "page": box["page"],
        "x": round(x0, 2),
        "y": round(y0, 2),
        "width": round(max(x1 - x0, 0.01), 2),
        "height": round(max(y1 - y0, 0.01), 2),
    }


def simulate(flat_pdf: Path, out_pdf: Path, page_sizes: list[dict], seed: str) -> dict:
    """Write a scanned-looking PDF; return the per-page angles and settings for the gold."""
    rng = random.Random(seed)
    dpi = rng.choice([100, 120, 150])
    quality = rng.randint(45, 80)
    angles = []
    with tempfile.TemporaryDirectory() as tmp:
        pages = rasterize(flat_pdf, dpi, Path(tmp))
        images = []
        for _ in pages:
            angles.append(round(rng.uniform(-1.8, 1.8), 2))
        for path, angle in zip(pages, angles, strict=True):
            images.append(degrade(Image.open(path), rng, angle))
        # Re-encode through JPEG to get realistic compression artefacts in the PDF.
        jpeg_pages = []
        for k, img in enumerate(images):
            p = Path(tmp) / f"j{k}.jpg"
            img.save(p, "JPEG", quality=quality, optimize=True)
            jpeg_pages.append(Image.open(p))
        jpeg_pages[0].save(
            out_pdf, "PDF", resolution=dpi, save_all=True, append_images=jpeg_pages[1:]
        )
    return {
        "dpi": dpi,
        "jpeg_quality": quality,
        "angles": angles,
        "page_sizes": [{"width": s["width"], "height": s["height"]} for s in page_sizes],
    }
