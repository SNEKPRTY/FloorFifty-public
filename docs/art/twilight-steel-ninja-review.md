# Twilight Steel Ninja: Art Review Record

Reviewed against `docs/art/twilight-steel-ninja-brief.md`.

**Status: awaiting human sign-off.** Everything below is machine-checked or
observed from captured renders. None of it is an art approval, and the release
gate is not met until a person has signed the table at the end.

## What The Machine Checked

`pnpm assets:check` validates all 10 assets on every run and in CI:

| Check | Result |
| --- | --- |
| Every alias the renderer addresses is declared exactly once | Pass |
| Declared frame dimensions match the files on disk | Pass |
| Every sprite has real transparency and a cut-out background | Pass |
| Every character sheet declares all five animations | Pass |
| Every asset declares a palette role from the contract | Pass |
| Every asset carries tool, prompt, source, and license provenance | Pass |
| No asset claims a licence from a tool that did not make it | Pass |
| The `audio` and `menu` bundles are empty by declaration, not by omission | Pass |
| No asset is declared that the renderer never addresses | Pass |

`tests/shared/asset-contract.test.ts` additionally proves each of those checks
fails when it should: a ninja missing its `land` row, a duplicate alias, an
off-contract palette role, a sprite on an opaque background, and a sheet whose
file is the wrong size are all rejected.

## Where The Art Came From

Provenance is recorded per asset in `packages/asset-contract/assets/art-manifest.json`,
and the licence line follows the tool: the four character sheets carry
PixelLab's commercial-use terms, and the six drawn plates are original work
made in this repository. Every asset used to carry the PixelLab line, including
the ones PixelLab never touched, which is a rights claim rather than a
formatting slip; a contract test now fails on it.

| Group | Tool | Why |
| --- | --- | --- |
| `ninja.*` (4 sheets) | PixelLab (`generate-image-pixflux` + `animate-with-text`) | A reference frame plus five text-driven animations gives one silhouette across four scarf colours |
| `world.sky`, `world.cityFar`, `world.cityNear`, `world.lanterns` | Drawn (`generate-placeholder.ts`) | 960px wide and must tile seamlessly; the generator caps an image at 400px |
| `world.sun`, `world.platform` | Drawn (`generate-placeholder.ts`) | Asked for an isolated prop the generator returned a small scene: a landscape with an opaque sky and a city skyline |

## Evidence

Captured by `tests/e2e/art-acceptance.spec.ts` at every target viewport, from
the running renderer rather than from the source files:

- `screenshots/desktop-{main-menu,ready-room,gameplay}.png` (1280 x 720)
- `screenshots/mobile-portrait-*.png` (390 x 844)
- `screenshots/mobile-landscape-*.png` (844 x 390)

Every capture asserts the canvas is non-blank before saving, so a screenshot in
this set cannot be a picture of a failed render.

## Observed Against The Brief

| Contract item | Observation |
| --- | --- |
| Indigo dusk sky, peach and gold sunset | Holds. The sun sets behind the skyline at every viewport |
| Charcoal foreground silhouettes | Holds. Near rooftops read darker than the far layer |
| Restrained teal edge highlight | Holds. Spent on platform top surfaces, which is what a player judges a landing against |
| Four readable scarf colours | Holds as identity. **See open item 1 on hue accuracy** |
| No baked typography in sprites | Holds. All text is drawn at runtime by the renderer and by the DOM; no sprite carries a glyph |
| Transparent sprite backgrounds | Holds, and is enforced |
| Five parallax layers | Holds |
| No legacy Bevy texture in the runtime | Holds. The only reference to the Bevy build in client source is a comment citing its camera values |

## Open Items For Human Review

1. **Scarf hue drift.** The generated scarves read pink and magenta rather than
   the contract's `#e8425c` scarlet and `#a36ce8` violet. The palette swatch is
   passed to the generator as a colour constraint but is applied weakly. Decide
   whether to accept the hues, re-render with a stronger constraint, or recolour
   the scarf pixels against the palette.

2. **Below the horizon.** Under the near skyline the frame falls back to the
   canvas clear colour. It is not wrong, and at the start of a climb it is
   visible. Decide whether a ground or haze layer is wanted.

3. **Overlapping players at spawn.** All players start on the same floor, so
   their sprites and nameplates overlap until the field spreads. A per-seat
   spawn offset is a gameplay change and is deliberately not made here.

4. **Character animation legibility.** `idle` carries more scarf motion than the
   brief implies. Judge at native scale as well as in the renderer.

## Sign-Off

Automated checks passing is a precondition, not an approval. Task 10 requires a
person to review the captures and the native sprite frames against the brief.

| Item | Reviewer | Date | Verdict |
| --- | --- | --- | --- |
| Character sheets at native scale | | | |
| Platforms and parallax in the renderer | | | |
| Palette and scarf hues | | | |
| Overall art acceptance | | | |
