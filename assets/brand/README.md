# SV brand assets

Source: [supplied official SV app artwork](https://play-lh.googleusercontent.com/hTDFNPQ1qIgd24DuQX6X96SrQxUrcHCddrTgf1FlnZbgKQP4MRY44CCssLoDgZ7Qr-8JwKMWfFq98nDcjqLm8w), downloaded 2026-11-06.
The source is 512×512. `sv-logo.png` is a 1024×1024 transparent PNG, upscaled
with Lanczos filtering, with the mark centered at 88% of the canvas height.
No SVG is supplied: an automatic trace would alter the official letterforms.

The modal opaque green is **sRGB #008E5C / RGB (0, 142, 92)** (51,259 source pixels).
Only the connected exterior, including the gap between the two green shapes,
is removed. The enclosed white S and V and their internal antialiasing remain
opaque. Exterior edges are unmatted against white to avoid a white fringe on dark surfaces.

`--lotse-color-brand` and `Color.lotseBrand` match the source green. The hover
and pressed variants are #007B50 and #006D47. The original green has 4.18:1
contrast on white, so normal text uses #006D47 (6.41:1) in light mode and
#78DBAD in dark mode. The logo itself retains its original colours.

## Regenerate

From the repository root, with Python and Pillow installed:

```sh
curl --fail --location 'https://play-lh.googleusercontent.com/hTDFNPQ1qIgd24DuQX6X96SrQxUrcHCddrTgf1FlnZbgKQP4MRY44CCssLoDgZ7Qr-8JwKMWfFq98nDcjqLm8w' -o assets/brand/sv-logo-source.png
python3 -m pip install --user Pillow
python3 scripts/generate-brand-assets.py
python3 scripts/test-brand-assets.py
bun run --filter @lotse/ui generate:styles
xcodegen generate --spec apps/mac/project.yml
```

If the Python user directory is outside the sandbox, install Pillow with
`python3 -m pip install --target /private/tmp/lotse-brand-python Pillow` and
prefix both Python script commands with `PYTHONPATH=/private/tmp/lotse-brand-python`.

The generator also creates the bundled LotseCore logo, the ten Mac app icon
slots (16, 32, 128, 256 and 512 points at 1× and 2×), the 16/32/48 favicon,
an opaque 180px Apple touch icon, and 192/512px manifest icons. Maskable icons
use an opaque white canvas and keep the mark within the central 80% safe circle.
The header logo has an empty alt because the adjacent app name labels its link;
the native menu logo carries the localized app name.

Deviation: this task explicitly requests SV branding, overriding the neutral
visual-language direction in PRD §6. No PRD or challenge data was changed.

## Verification (2026-11-06)

- `bun run typecheck`: all eight packages successful.
- UI suite: 115 tests passed, including light/dark AA contrast; generated CSS checked.
- `python3 scripts/test-brand-assets.py`: four artifact checks passed (alpha,
  opaque letters, exact green, icon sizes, maskable safe circle, bundled copies).
- Focused native brand suite: two tests passed with real resource loading and sRGB conversion.
- SwiftLint on the three changed Swift files: zero violations; Mac source boundaries passed.
- XcodeGen regenerated the project, including the AppIcon setting and asset catalog resource.
- Apple `actool` successfully compiled the catalog to `AppIcon.icns` and `Assets.car`.
- Development HTTP checks: manifest, logo, favicon and Apple touch icon returned 200;
  served logo bytes matched the master. Temporary server was stopped afterward.

Validation limitations: full Xcode build stopped at dependency resolution because nested
`sandbox-exec` is unavailable. The web release build stopped at the existing release
scan because the local environment sets `BRAIN_ALLOW_STUBS`; no environment file was changed.
Full-page visual verification was blocked by development bundling errors in the existing
telemetry/PDF viewer imports. Native menu interaction and VoiceOver require the owner’s GUI check.
