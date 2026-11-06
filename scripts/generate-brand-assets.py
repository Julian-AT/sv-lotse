"""Regenerate icons from the supplied official raster (requires Pillow).

Download assets/brand/sv-logo-source.png with curl first; see assets/brand/README.md.
Only the connected exterior is removed, so enclosed white lettering stays opaque.
"""

from collections import Counter, deque
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets/brand"
WEB = ROOT / "apps/web/public"
CATALOG = ROOT / "apps/mac/App/Assets.xcassets"
CORE = ROOT / "apps/mac/Packages/LotseKit/Sources/LotseCore/Resources"
MASTER_SIZE = 1024
LOGO_COVERAGE = 0.88
MASKABLE_COVERAGE = 0.70
MAC_SIZES = (16, 32, 128, 256, 512)
# macOS app icon template: an 824 pt rounded tile inside the 1024 pt canvas, so the Dock, Finder and
# app switcher show a native tile instead of a bare mark (macOS 26 would otherwise put it in a grey tile).
MAC_TILE = 824
MAC_TILE_RADIUS = 185
MAC_MARK_COVERAGE = 0.66


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def remove_exterior(source):
    image = source.convert("RGBA")
    width, height = image.size
    green = Counter(
        (r, g, b) for r, g, b, a in image.get_flattened_data()
        if a == 255 and g > r and g > b
    ).most_common(1)[0][0]
    pixels = image.load()
    exterior = set()
    queue = deque(
        [(x, y) for x in range(width) for y in (0, height - 1)]
        + [(x, y) for y in range(height) for x in (0, width - 1)]
    )
    while queue:
        x, y = queue.popleft()
        if (x, y) in exterior or not (0 <= x < width and 0 <= y < height):
            continue
        r, g, b, a = pixels[x, y]
        if a and max(abs(c - base) for c, base in zip((r, g, b), green)) <= 8:
            continue
        exterior.add((x, y))
        queue.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    for x, y in exterior:
        r, g, b, a = pixels[x, y]
        # Undo the white matte at the outside edge. Internal letter edges are untouched.
        alpha = min(a, 255 - r) if g > r and g > b else 0
        pixels[x, y] = (*green, alpha)
    # The two enclosed letters must remain solid white, not holes in the silhouette.
    for point in ((180, 250), (300, 250)):
        assert image.getpixel(point) == source.getpixel(point) == (255, 255, 255, 255)
    return image.crop(image.getbbox()), green


def fit(logo, size, coverage=LOGO_COVERAGE, opaque=False):
    canvas = Image.new("RGBA", (size, size), "white" if opaque else (0, 0, 0, 0))
    mark = logo.copy()
    mark.thumbnail((round(size * coverage), round(size * coverage)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas.convert("RGB") if opaque else canvas


def mac_icon(logo):
    canvas = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
    inset = (MASTER_SIZE - MAC_TILE) // 2
    box = (inset, inset, inset + MAC_TILE - 1, inset + MAC_TILE - 1)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (box[0], box[1] + 10, box[2], box[3] + 10), MAC_TILE_RADIUS, fill=(0, 0, 0, 70)
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    ImageDraw.Draw(canvas).rounded_rectangle(box, MAC_TILE_RADIUS, fill=(255, 255, 255, 255))
    mark = logo.copy()
    mark.thumbnail((round(MAC_TILE * MAC_MARK_COVERAGE),) * 2, Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((MASTER_SIZE - mark.width) // 2, (MASTER_SIZE - mark.height) // 2))
    return canvas


def generate():
    source = Image.open(BRAND / "sv-logo-source.png").convert("RGBA")
    logo, green = remove_exterior(source)
    # Resize up once at high quality; thumbnail itself intentionally never enlarges.
    logo = logo.resize((round(logo.width * MASTER_SIZE / logo.height), MASTER_SIZE), Image.Resampling.LANCZOS)
    master = fit(logo, MASTER_SIZE)
    master.save(BRAND / "sv-logo.png")
    (WEB / "brand").mkdir(parents=True, exist_ok=True)
    (WEB / "icons").mkdir(parents=True, exist_ok=True)
    master.save(WEB / "brand/sv-logo.png")
    master.save(CORE / "sv-logo.png")
    master.save(WEB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    fit(logo, 180, opaque=True).save(WEB / "apple-touch-icon.png")
    for size in (192, 512):
        fit(logo, size).save(WEB / f"icons/icon-{size}.png")
        fit(logo, size, MASKABLE_COVERAGE, opaque=True).save(WEB / f"icons/icon-maskable-{size}.png")
    images = []
    mac_master = mac_icon(logo)
    for size in MAC_SIZES:
        for scale in (1, 2):
            filename = f"icon_{size}x{size}@{scale}x.png"
            destination = CATALOG / "AppIcon.appiconset" / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            mac_master.resize((size * scale, size * scale), Image.Resampling.LANCZOS).save(destination)
            images.append({"filename": filename, "idiom": "mac", "size": f"{size}x{size}", "scale": f"{scale}x"})
    info = {"author": "dev.svkilotse.mac", "version": 1}
    write_json(CATALOG / "Contents.json", {"info": info})
    write_json(CATALOG / "AppIcon.appiconset/Contents.json", {"images": images, "info": info})
    assert master.size == (MASTER_SIZE, MASTER_SIZE)
    assert master.getpixel((0, 0))[3] == 0
    assert green == (0, 142, 92)
    print(f"Generated brand assets; measured modal green: #{green[0]:02x}{green[1]:02x}{green[2]:02x}")


if __name__ == "__main__":
    generate()
