# Floor Fifty — hand-authored art brief

Date: 2026-09-22

Status: **Retired 2026-09-26** by amendment 16 of the launch polish program, which cut the art pass: the art was replaced as phases 1b, 1c and 2b were worked, and no commission goes out. Kept as a record. Previously: **Ready to send.** This brief was pulled forward from launch polish plan Task 6.1 (spec §3.5) by the mockup-parity plan (2026-09-22-mockup-parity.md, Task 1).

## Why this brief exists

Every raster in the game today was generated or procedurally drafted, then converted onto the palette in this repository. The launch art is hand-drawn. Each slot below is a commission: the generated asset now in the slot is a **placeholder**. It shows the composition and scale being asked for. It does not set the style ceiling.

Visual authority, in this order:

1. [`extended-stage.png`](explorations/2026-09-20-refinement/extended-stage.png): the stage, its depth ladder and the four-panel ascent.
2. [`aquarian.png`](explorations/2026-09-20-refinement/aquarian.png): the menu composition, the race frame and the character scale.
3. The review records: [Aquarian](aquarian-beauty-pass-review.md) and [Overhaul #2](overhaul-2-review.md).

## Rules for every asset

- **Palette:** Resurrect 64 only, with every pixel on one of the 64 swatches. Each slot below names its **palette roles**; stay inside them. The roles and their swatches are listed in `packages/asset-contract/src/roles.ts`, and the swatch sheet is `packages/asset-contract/src/palette.css`.
- **Format:** PNG with alpha, at exactly the final size given. No anti-aliasing against transparency: an edge pixel is either a swatch or transparent.
- **Scenery strips** tile horizontally across a 960-unit course, so the left and right edges must meet without a seam. Skylines are bottom-anchored. Every building must run straight to the bottom row, because the game continues each strip below its last row.
- **Nothing in the scenery may read as a landing surface.** No continuous ledges, and no colour within reach of the platform tops (`platformTop`, `platformMovingTop`).
- **Delivery:** each asset lands through `pnpm assets:check`. Its manifest row changes `provenance.tool` to the artist, removes `provenance.status: "placeholder"`, and keeps the alias and file name. The generated source it replaces stays in `packages/asset-contract/assets/source/` as a record.

## The slots

The **Prompt / source** column says where the placeholder came from:
- `IMAGE_PROMPTS.<name>` is a prompt in `packages/asset-contract/tools/image-prompts.ts`, generated with gpt-image-2.5-flare.
- "ImageGen" means an earlier OpenAI ImageGen source, committed under `assets/source/`.
- "drafted" means drawn by a script in `packages/asset-contract/tools/`.

### Characters

| Alias | File | Size | Roles | Layer | Reference | Prompt / source | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ninja.scarlet` / `.cyan` / `.gold` / `.violet` | `ninja-<seat>.png` | 4 × 5 grid of 32 × 32 frames (run, idle, jump, fall, land rows, per the manifest) | `outline`, the seat colour | World sprites | `aquarian.png` race panel | gpt-image-2 sheet `racer-sheet.png` | generated, accepted |
| `portrait.<seat>` | `portrait-<seat>.png` | 64 × 64 | `outline`, `cloud`, the seat colour | Ready room seat | — | `IMAGE_PROMPTS.portraits` (column 1) | placeholder |
| `portrait.<seat>Win` | `portrait-<seat>-win.png` | 64 × 64 | as above | Results, winner | — | `IMAGE_PROMPTS.portraits` (column 2) | placeholder |
| `portrait.<seat>Lose` | `portrait-<seat>-lose.png` | 64 × 64 | as above | Results, everyone else | — | `IMAGE_PROMPTS.portraits` (column 3) | placeholder |

**The portrait set: four seats × three expressions.** Twelve head-and-shoulders busts of the masked ninjas, facing the viewer:
- **Neutral:** calm, eyes forward.
- **Win:** eyes closed in upturned arcs, one fist raised.
- **Lose:** eyes down, shoulders slumped.

Each bust has a dark outline, the seat colour as the body with one step of shade allowed from the same seat's ramp, and white eyes (`cloud`). The mask covers everything below the eyes, so the eyes carry the whole expression and have to read at 40 CSS px. The seat is also named in text beside every portrait, so a portrait never has to identify a racer alone.

### Stage: sky plate (refracted)

| Alias | File | Size | Roles | Reference | Prompt / source | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `world.sun` | `world-sun.png` | 256 × 256 | `cloud`, `skyLow`, `cityWindow` | Low warm disc behind the city, both boards | `IMAGE_PROMPTS.sun` | placeholder |
| `world.clouds` | `world-clouds.png` | 960 × 140, seamless | `cloud`, `skyLow`, `skyMid` | Wispy streaks with peach-lit undersides, both boards | `IMAGE_PROMPTS.clouds` | placeholder |

The sun must have hard alpha: its glow rings are solid swatch bands, never partial transparency. A translucent falloff turns into a mint ring once the palette lock folds it.

### Stage: city stack (crisp, never blurred)

| Alias | File | Size | Roles | Reference | Prompt / source | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `world.cityFar` | `world-city-far.png` | 960 × 360 | `cityFar` | Palest skyline; haze does the depth | ImageGen `city-far.png` | generated, accepted |
| `world.cityMid` | `world-city-mid.png` | 960 × 400 | `cityMid`, `cityWindow` | Hazy blue towers and spires that rise above the near rooftops | `IMAGE_PROMPTS.cityMid` | placeholder |
| `world.cityNear` | `world-city-near.png` | 960 × 440 | `cityNear`, `cityNearEdge`, `cityWindow` | Deep slate-navy rooftops, lit windows up to 12% of the facade, grouped in panes | `IMAGE_PROMPTS.cityNear` | placeholder |
| `world.lanterns` | `world-lanterns.png` | 960 × 440, tiles vertically | `cityWindow` | Scattered lit windows over the near skyline | drafted | generated, accepted |
| `world.rooftopDetails` | `world-rooftop-details.png` | 960 × 220 | `rooftopDetails` | Vents, aerials and tanks on the nearest roofs | ImageGen `rooftop-details.png` | generated, accepted |
| `world.rooftopProps` | `world-rooftop-props.png` | 960 × 220 | `rooftopDetails`, `rooftopFoliage` | Water towers, fire escapes, pipes and planters; no ground line | `IMAGE_PROMPTS.props` | placeholder |

### Stage: platforms

| Alias | File | Size | Roles | Reference | Prompt / source | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `world.platform` | `world-platform.png` | 128 × 64 (two 128 × 32 frames: static and moving) | `platformOutline`, `platformBody`, `platformGlow`, `platformTop`, `platformMovingTop` | Grass-green top over a slab, both boards | gpt-image-2 `platform.png` | generated, accepted |

The collision shape is fixed: the slab must fill the frame's inset box (2 px each side), and the top face stays on the top rows.

### Menu

| Alias | File | Size | Roles | Reference | Prompt / source | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `menu.sky` | `menu-sky.png` | 960 × 540, full frame | `skyHigh`, `skyMid`, `skyLow`, `cloud`, `cityWindow` | The Aquarian board's menu sky | `IMAGE_PROMPTS.menuSky` | placeholder |
| `menu.city` | `menu-city.png` | 960 × 540, lower half | `cityFar`, `cityMid`, `cityNear`, `cityWindow` | The Aquarian board's menu skyline | `IMAGE_PROMPTS.menuCity` | placeholder |
| `menu.ledge` | `menu-ledge.png` | 480 × 96 | `outline`, `platformBody`, `rooftopFoliage`, `cityNear` | The rooftop the four menu ninjas stand on | `IMAGE_PROMPTS.menuLedge` | placeholder |
| `menu.backdrop` | `menu-backdrop.png` | 960 × 540 | the sky and city roles | Fallback composite when the split plates are missing | ImageGen `menu-backdrop.png` | generated, fallback only |

### Tutorial stage: dawn

The tutorial's own stage (the project's internal notes). The target picture is `packages/asset-contract/assets/source/dawn-concept.png`: a hazy violet-to-teal dawn, the sun resting on a pale pyramid's apex, misty teal hills in the fog, and a black domed building with a flag among black rooftops. The racers and floors are drawn black at runtime, so the backdrop must stay light enough for them to read against.

| Alias | File | Size | Roles | Reference | Prompt / source | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `world.dawnSky` | `world-dawn-sky.png` | 960 × 640, full frame; its top and bottom rows are stretched to fill tall frames, so keep them flat | `dawnHaze`, `dawnHigh`, `dawnGlow`, `dawnSun`, `dawnSunCore`, `dawnTeal`, `dawnFog` | Sky, sun and pyramid in one soft plate (refracted) | `IMAGE_PROMPTS["dawn-sky"]` | placeholder |
| `world.dawnMist` | `world-dawn-mist.png` | 960 × 360, tiles horizontally; hills in the lower half only | `dawnGlow`, `dawnHigh`, `dawnTeal` | Pale misty teal hills, lower in the middle so the pyramid stands clear | `IMAGE_PROMPTS["dawn-mist"]` | placeholder |
| `world.dawnNear` | `world-dawn-near.png` | 960 × 440, tiles horizontally | `outline` only | Flat black rooftops and the domed building with its flag | `IMAGE_PROMPTS["dawn-near"]` | placeholder |

## Priority for the artist

1. The portraits, since they are the only characters shown at a large size.
2. The near skyline and rooftop props, which sit right behind the play.
3. The menu set.
4. The sky plate, and the tutorial's dawn set.
5. Everything marked "generated, accepted", last.
