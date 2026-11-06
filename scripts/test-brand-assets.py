"""Check delivered brand artifacts with real image data; requires Pillow."""

import json
from pathlib import Path
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


class BrandAssetsTests(unittest.TestCase):
    def test_master_keeps_white_letters_and_transparent_exterior(self):
        with Image.open(ROOT / "assets/brand/sv-logo.png") as image:
            self.assertEqual(image.size, (1024, 1024))
            self.assertEqual(image.mode, "RGBA")
            # Both letter interiors are opaque white; the outer margin and split are clear.
            for point in ((320, 500), (620, 500)):
                self.assertEqual(image.getpixel(point), (255, 255, 255, 255))
            for point in ((0, 0), (100, 500), (512, 500), (1023, 1023)):
                self.assertEqual(image.getpixel(point)[3], 0)
            self.assertEqual(image.getpixel((400, 350)), (0, 142, 92, 255))

    def test_mac_catalog_covers_every_required_size(self):
        catalog = ROOT / "apps/mac/App/Assets.xcassets/AppIcon.appiconset"
        images = json.loads((catalog / "Contents.json").read_text())["images"]
        expected = {(size, scale) for size in (16, 32, 128, 256, 512) for scale in (1, 2)}
        actual = set()
        for entry in images:
            size = int(entry["size"].split("x")[0])
            scale = int(entry["scale"].removesuffix("x"))
            actual.add((size, scale))
            self.assertEqual(entry["idiom"], "mac")
            with Image.open(catalog / entry["filename"]) as image:
                self.assertEqual(image.size, (size * scale, size * scale))
                self.assertEqual(image.getpixel((0, 0))[3], 0)
        self.assertEqual(actual, expected)

    def test_web_manifest_resolves_real_images_and_maskable_safe_area(self):
        manifest = json.loads((ROOT / "apps/web/src/app/manifest.webmanifest").read_text())
        public = ROOT / "apps/web/public"
        self.assertEqual(manifest["theme_color"], "#008e5c")
        for entry in manifest["icons"]:
            with Image.open(public / entry["src"].lstrip("/")) as image:
                size = image.width
                self.assertEqual(entry["sizes"], f"{size}x{size}")
                if entry["purpose"] == "maskable":
                    self.assertEqual(image.mode, "RGB")
                    # All non-white artwork fits inside the W3C maskable safe circle.
                    for y in range(size):
                        for x in range(size):
                            if image.getpixel((x, y)) != (255, 255, 255):
                                self.assertLessEqual((x - size / 2) ** 2 + (y - size / 2) ** 2, (size * 0.4) ** 2)
        with Image.open(public / "apple-touch-icon.png") as image:
            self.assertEqual(image.size, (180, 180))
            self.assertEqual(image.mode, "RGB")
        with Image.open(public / "favicon.ico") as image:
            self.assertEqual(image.ico.sizes(), {(16, 16), (32, 32), (48, 48)})

    def test_web_and_native_bundle_preserve_the_same_master(self):
        master = (ROOT / "assets/brand/sv-logo.png").read_bytes()
        for path in (
            "apps/web/public/brand/sv-logo.png",
            "apps/mac/Packages/LotseKit/Sources/LotseCore/Resources/sv-logo.png",
        ):
            self.assertEqual((ROOT / path).read_bytes(), master)


if __name__ == "__main__":
    unittest.main()
