# Visual Overhaul #2 — review

Date opened: 2026-09-22

Plan: 2026-09-22-launch-polish-program.md, phase 1
Spec: 2026-09-22-launch-polish-program-design.md
Board: [extended-stage.png](explorations/2026-09-20-refinement/extended-stage.png)

## Status

**Accepted 2026-09-23 as a blanket sign-off** ("phase 1 is complete"). The
items under *For the gate* were not walked one by one. The sign-off covers
phases 1, 1b and 1c (the living stage) together.

As originally recorded: Phase 1
(Tasks 1.0–1.9) and phase 1b, mockup parity
(plan, spec §2.8), have
both landed. The automated gate and the frame budget are green, and the agent
has inspected the evidence. What the user is asked to judge, item by item, is
listed under *For the gate*. A blanket sign-off will be recorded as a blanket
one.

| | |
| --- | --- |
| **Automated pass** | Green. See *Automated results* and *Phase 1b*. |
| **Frame budget** | Green on all three projects. |
| **Agent visual inspection** | Done. The phase 1 finding (the city leaving the frame by combine) was closed by phase 1b's arc. |
| **User visual and motion approval** | **Not yet given.** |

## Changes to the accepted look

The phase changes things the Aquarian sign-off accepted. They are listed here
so the sign-off asked for at the gate is asked for knowingly.

- **Menu refraction (Task 1.0).** The refraction now measures its warp against
  its own frame instead of the pooled texture it sits in. Before the fix the
  warp was anisotropic and moved with pixel density (10.1 logical units
  horizontally against 15.4 vertically at DPR 2); after it both axes measure 9.1
  at DPR 1 and at DPR 2. The menu's optics are therefore rounder and a little
  weaker vertically than the look that was accepted.
- **Gameplay refraction is sky-only (Tasks 1.1–1.2).** The city is no longer
  refracted, bloomed or linearly upscaled; it is drawn at device resolution
  with nearest sampling above the refracted sky plate. The beat's window glow
  now brightens the lit windows directly rather than blooming them.
- **Sky grade (Task 1.4).** Blue overhead through the upper 30% of the frame,
  lilac by 48%, peach by 66%, where the old grade was lilac by a quarter of the
  way down. The grade is now measured against its own frame, and the horizon
  now *falls* as the climb goes on, where it used to rise. Before, every race
  ended in a peach field; the board's open-sky finish is its bluest panel. The menu's baked
  plate (`tools/generate-city.ts`) still carries the old grade, so the menu sky
  and the race sky no longer match exactly.

## Atmospheric depth (Task 1.4)

### Luma targets, measured from the board

Median luma of hand-picked patches in the board's "Above the rooftops" panel,
at the board's full resolution (1672 × 941):

| Region | Luma | Median colour |
| --- | --- | --- |
| Far skyline | 156–186 | `rgb(115,162,224)` – `rgb(149,190,250)` |
| Middle skyline | 75–159 | `rgb(51,77,122)` – `rgb(124,164,213)` |
| Near rooftops | 42–48 | `rgb(30,43,66)` – `rgb(35,49,82)` |
| Sky, overhead | 187 | `rgb(135,196,253)` |
| Sky, mid-height | 205 | `rgb(175,210,242)` |
| Sky, horizon | 219 | `rgb(249,209,230)` |

### Swatches

No swatch was added. Two roles were rebound to match the measured depth
ladder (spec 2.4.2, "pale blue-grey (far) to deep slate-navy (near)"):

| Role | Was | Now |
| --- | --- | --- |
| `cityFar` | `#9babb2`, 168 | unchanged |
| `cityMid` | `#7f708a`, 117 (violet slate) | `#4d65b4`, 102 (blue) |
| `cityNear` | `#625565`, 89 (slate-plum) | `#323353`, 53 (slate-navy) |

`roles.ts` records why `cityNear` had been lightened to 89. Measuring the
board showed that the light blue-slate masses are its *middle* skyline, and
the near rooftops sit at 42–48 luma. The plates were regenerated from their
committed sources.

Haze is how the layers move toward the targets. A smooth tint cannot do it:
the city's palette lock folds every pixel back onto a swatch, and a
simulation of the lock showed a tint either landing on the layer's own swatch
or jumping the whole layer onto its neighbour's (with the old roles, mid onto
far at 30% and near onto mid at 20%). So haze is an ordered dither, baked into each strip's texels at
mount: the authored share of texels is stepped to the next swatch toward the
sky. Every result is a swatch, so the lock leaves it alone, and the stipple is
fixed to the art rather than crawling as the layer scrolls.

| Layer | Haze | Stepped to |
| --- | --- | --- |
| Far | 0.25 | `#8fd3ff` (`skyHigh`, 200) |
| Middle | 0.125 | the next swatch toward the sky from `#4d65b4` |
| Near | 0 | — |

The amounts were lowered from a first try of 0.35 / 0.2 after inspection: at
0.35 the far skyline read as a coarse checkerboard.

### Sky and seat contrast

The contract is at least 40 luma between every player colour and every sky
tone. It now covers the lilac band (`skyMid`) as well as overhead and the
horizon, because the re-grade puts that band where racers spend the middle of
a climb. It holds for all four seats.

## Details and platform finish (Task 1.6)

- **Platform top face** rebound from `#b2ba90` (sage, hue 71) to `#91db69`
  (luma 195, hue 99). The board's top face samples at `rgb(186,218,159)`,
  hue 94. The slab's collision geometry and sheet size are unchanged; only the
  regenerated sheet's colours moved.
- **Scenery kept off the landing surfaces.** No scenery role, and no pixel of
  any scenery plate on disk, comes within weighted distance 112 of either top
  face (static or moving). 112 is the closest seat pair the art review
  accepted. It is checked on the art files rather than on a screenshot, where
  racers and platforms would be counted as scenery.
- **Placeholder rooftop props** (`world.rooftopProps`): water towers, aerials,
  spires and planters, generated with **gpt-image-2.5-flare** on a magenta key
  and converted by `generate-city.ts`. The strip uses the details' ink and a
  new `rooftopFoliage` role (`#165a4c`, dark teal-green, clear of the grass
  top). The manifest flags the strip `status: "placeholder"` for the phase 6
  art pass. The prompt was also run on `gpt-image-2.5-sunburst`; that result
  was rejected because it drew a continuous ground line under the props, which
  reads as a ledge.
- **Cyan underglow: not changed.** The board's cyan line under each platform
  maps to the floor indicator bar, whose colours follow the reference
  (`Color::GREEN` and `Color::ORANGE_RED`). They were left alone.

## Nameplates (Task 1.7)

Racers inside one plate-sized box (64 × 40 world units) are one cluster. The
local plate always shows. Every other plate in the cluster folds into a single
chip that counts the whole cluster ("×4"), placed above the top seat lane. A
new grouping only takes effect once it has held for 150 ms, so plates don't
flap as racers brush past each other.

## Portrait (Task 1.8)

- **Anchor (D3).** In portrait the camera holds the local racer 216 logical
  units above the field's bottom edge. Landscape still centres it at 270.
- **Placement.** The field sits 60 CSS px from the top, under the metric row
  and in the upper half. At 390 × 844 it spans y 60–279.
- **City.** In portrait the whole city sinks, as one shift, until no layer
  starts above the lower third of the canvas. The shift is measured at the
  start of the climb, so the city still parallaxes as the camera climbs.
- **Rotate hint.** "Turn your phone for a bigger view" appears once, in the
  ready room, in portrait only. The dismissal is stored per device. It still
  renders and dismisses when storage throws.
- **HUD.** Portrait shows the metric row and a strip of seat-coloured pips,
  each with a progress ring. The strip sits below the field. A pip shows its
  racer's name on press or focus, and keeps it for 1.5 s after release. The
  pips are the HUD's only pointer targets (44 × 44).
- **LCD grid strength.** Measured on the gameplay sky band at 1536 × 864:
  mean saturation is 0.363 with the panel and 0.362 without, and mean luma is
  196.6 against 206.6. The board's sky measures 0.334 and 197.3. The panel
  darkens the sky by about 10 luma but does not desaturate it. The magenta
  cast seen in the earlier captures came from the sky grade, which Task 1.4
  fixed. After the re-grade, the panel's luma matches the board, so `grid`
  stays at 0.15. Before and after for this item are the same value, and that
  is recorded as a decision rather than an omission.

## Automated results (Task 1.9)

Run on 2026-09-22 on an Apple M1 with a display:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | 106 files, 1080 tests, all passing |
| `pnpm content:check --verify-artifact` | passing; `rulesetRevision` unchanged by every phase 1 change |
| `pnpm assets:check` | 25 assets validated |
| client build | passing |
| `CI=1 pnpm test:e2e` (desktop, mobile-portrait, mobile-landscape) | 75 passed, 22 skipped by project |
| `CI=1 pnpm test:e2e:budget` | 3 passed; menu refraction median 16.7 ms (p95 ≤ 17.7), gameplay chain median 16.6–16.7 ms (p95 ≤ 17.8) |

The canvas-pixel acceptance tests from spec 2.6:

- **The city isn't refracted.** Of 908 edges inside the city (windows
  against walls, one skyline against another) at 2 device pixels per unit,
  902 are single-pixel steps. The e2e runs with the inspection-only
  `?lcd=off`, because the LCD panel softens every edge by design. It also
  counts only edges with a city colour on both sides. Two narrower forms of
  the measure were tried and dropped. Counting every edge in the lower half
  included the world composite's stepped platform lips and glowing floor bars.
  Counting city-against-sky edges included the sky's dither, which is
  linearly upscaled and so textured by design.
- **The sky is refracted and the city holds.** The sky plate's refraction
  is reported as `sky-only` by the inspection hook. A unit test holds lift and
  drift fixed and checks that the clouds move with ambient time while every
  city layer stays put. Pixels are not compared directly, because the city's
  window twinkle changes city pixels on purpose.
- **Render path (2.7).** A ticker-order test pins the draw → backdrop →
  composite → render order. The refraction isotropy e2e measures 9.1 logical
  units on both axes at DPR 1 and 2. A reduced-motion test holds the camera
  breath and platform swell still.

## Evidence

Everything is in [`screenshots/overhaul-2/`](screenshots/overhaul-2/): the
Aquarian matrix (menu, ready room, race and results at three viewports, plus
the error, low-quality and reduced-motion stills and two traversals) and the
four phrase captures. Each phrase is shot in its own race: the test driver's
last steering input stays held between calls, so a racer can climb straight
through a four-floor band. The four are also laid out two by two, like the
board, in
[`desktop-phrases-board.png`](screenshots/overhaul-2/desktop-phrases-board.png).

## Agent inspection

- **Teach (floor 1).** Close to the board's "lower rooftops": a deep navy near
  city with amber windows, blue towers behind it, placeholder props on the
  roofline, and green platform tops. The lilac band now sits behind the sun at
  mid-height.
- **Combine (floor 7).** **Finding:** the near city is down to rooftops along
  the bottom edge, and only the far towers stand in the frame. The board's
  second panel still shows the middle skyline at mid-frame. The accepted
  Aquarian captures show the same departure, so it predates this phase. The
  ascent arc can only add to it, because the city leaves through the camera's
  vertical parallax. The fix would be to drive the city's vertical position
  from the arc instead of from the camera, keeping a little of the parallax
  for depth. That changes how the stage moves under every bounce, so it is
  left for the user to decide rather than tuned here.
- **Recover (13) and finish (16).** Open sky, bluer overhead than before the
  horizon fix. The lower half is still mostly peach, where the board's finish
  keeps its peach to a band at the horizon.
- **Portrait (390 × 844).** The field sits under the metric row with the
  racer low in it. The pip strip sits below the field, and the city fills the
  lower third above the touch buttons.

## For the gate (phases 1 and 1b together)

The user is asked to judge each of these against `extended-stage.png`:

1. The four phrase captures, side by side with the board.
2. The depth ladder: pale blue-grey far skyline, blue middle, deep navy near.
3. The sky grade, including the horizon falling as the climb goes on.
4. The crisp city against the soft sky.
5. Green platform tops, and the placeholder props (gpt-image-2.5-flare).
6. The count chip in place of stacked nameplates.
7. Portrait on a phone: the 216-unit anchor (D3), the field placement, the pip
   HUD and the rotate hint.
8. The corrected menu refraction, which changes the accepted menu look.
9. The arc-driven city (decided and built in phase 1b): does the phrase board
   now read like the extended-stage board's four panels?
10. The menu against the Aquarian board's top panel: the sky/city split, the
    ledge, the light wordmark and the keycaps.
11. The race HUD against the board's bottom panel.
12. The generated placeholders (portraits, sun, clouds, middle skyline, near
    skyline, props, menu plates): good enough to ship until the commissioned
    set lands?

## Phase 1b: mockup parity

Closes spec §2.8's items 1–12 plus the character portraits. Every new raster
was generated with **gpt-image-2.5-flare** from the committed prompt table
(`packages/asset-contract/tools/image-prompts.ts`) and converted onto the
palette in this repository. Each is flagged `provenance.status: "placeholder"`
and listed in the [commissioning brief](hand-authored-art-brief.md).

| §2.8 item | What changed | Evidence |
| --- | --- | --- |
| 1. Menu backdrop | Refracted sky plate (gameplay optics profile) with a crisp city over it; the old composite is kept as the fallback | `desktop-menu.png` |
| 2. Rooftop ledge | The four racers stand on a ledge in the menu | `desktop-menu.png`, `mobile-portrait-menu.png` |
| 3. Wordmark | Pearl fill, slate edge and drop | `desktop-menu.png` |
| 4. Key hints | Keycaps on a frosted panel; "Up to four friends" inside the panel; → glyphs on the buttons | `desktop-menu.png` |
| 5. Sky grade | Blue down to 46% of the frame, a lilac band of 8%, then peach; the horizon falls as the climb goes on | `desktop-race.png`, phrase board |
| 6. Clouds | Wispy streaks lit peach underneath, on the 2 px grid, with transparent wrap margins | `desktop-race.png` |
| 7. Sun | A warm disc with hard alpha, white core and peach glow, drawn at 0.55 scale low behind the rooftops; the mint ring is gone | `desktop-race.png` |
| 8. Middle distance | Blue towers and spires rising above the near rooftops | `desktop-race.png` |
| 9. Windows | Near facades lit at 3–12% of their area (the cap was raised from 5%), in panes | `desktop-race.png` |
| 10. Props | Water towers, fire escapes, pipes and planters; sparse cap 18% | `desktop-race.png` |
| 11. Ascent arc | The arc carries the city, with 15% camera coupling; values 0 / 40 / 120 / 560 | `desktop-phrases-board.png` |
| 12. Race HUD | Two-line "FLOORS 02 / 20", a larger centred timer, a lap-headed roster panel of dots and names | `desktop-race.png`, `mobile-landscape-race.png` |
| Portraits | 64 × 64 busts per seat in neutral, win and lose; neutral in the ready room, win/lose in results | `desktop-ready-room.png`, `desktop-results.png` |

**Agent inspection.**
- The menu and the race now read like the two panels of the Aquarian board.
- The phrase board follows the extended-stage board's four panels: dense
  rooftops at teach, the skyline still in frame at combine, the city in the
  lower third at recover, and spires in open sky at the finish.
- Remaining differences:
  - A faint mint fringe on the menu clouds, where the refraction blends peach
    into blue.
  - Sparser, flatter clouds than the boards' painted skies.
  - The portrait menu and results keep their flat peach below the backdrop
    band, and the landscape results heading still clips. Both are on the
    user's own list from the phase 1 screenshot review.

**Follow-ups the user asked for during phase 1b** (recorded in the plan and not
built yet): clouds scattered at random and drifting like real clouds, and
parallax on the main menu.

**Automated gate for phases 1 + 1b** (2026-09-22, Apple M1 with a display):

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm test` | 108 files, 1117 tests, all passing |
| `pnpm content:check --verify-artifact` | passing; `rulesetRevision` unchanged |
| `pnpm assets:check` | 36 assets validated |
| client build | passing |
| `CI=1 pnpm test:e2e` | 73 passed, 22 skipped by project, **2 flaky** (passed on retry) |
| `CI=1 pnpm test:e2e:budget` | 3 passed; menu refraction median 16.6–16.7 ms (p95 ≤ 18.6), gameplay chain median 16.6–16.7 ms (p95 ≤ 18.2) |

The two flaky tests only fail under the full parallel matrix, and each passes
on its retry and when run on its own:

- "low quality is static but still draws" (`dawn-refraction.spec.ts`). It now
  waits for the menu to settle before asserting it is still, but the first
  attempt can still catch motion under load.
- "captures the four course phrases" (`aquarian-evidence.spec.ts`). The test
  driver can overshoot a four-floor band.

Neither is a product defect that has been demonstrated, but both are left
open rather than called fixed.

## Phase 1c: a living stage

Plan, spec §2.9.

| Item | What changed | Evidence |
| --- | --- | --- |
| Clear glass on the city | Dawn Refraction reaches every gameplay background layer: the sky keeps its soft optics, and the city takes a warp-only, nearest-sampled "glass". Inspection reports `sky+glass`. In-city edges are still 98% single-pixel steps (864 of 880). | `desktop-race.png`, `desktop-traversal.webm` |
| Drifting clouds | Seven clouds cut from the cloud plate, scattered from a fixed seed at varied heights and scales. Each drifts at its own speed (bigger is nearer and faster) and wraps on its own. They hold still under reduced motion. | `desktop-traversal.webm`, phrase board |
| Menu parallax | The menu is layered: a refracted clear sky with its drifting clouds, a far city under glass, and a crisp near city. The layers sway and lean toward a mouse pointer, and hold under reduced motion. | `desktop-menu-parallax.webm`, `desktop-menu.png` |

**Verification** (targeted, per the user's direction; the full gate was not run):
- The relevant unit and contract tests pass.
- The Overhaul #2 evidence spec passed on all three projects.
- The refraction spec passed on desktop, with the low-quality stillness test now hiding the DOM overlay.
- The desktop frame budget passed on retry: menu median 16.7 ms (p95 17.2), gameplay median 16.7 ms (p95 17.3). The first attempt's gameplay p95 was 35.3 ms, over the 33.4 ms limit. The glass is one more pass at device resolution, so this is worth watching on a phone.

### Changes after the user's review of phase 1c

- **The menu sky is the original painted plate again.** Its big cloud banks and pink bands wave under the full menu refraction, as in the pre-phase-1b menu the user preferred. The far and near city layers stand over it. The generated clear sky and the menu cloud strip were removed.
- **The race keeps a single drifting cloud band.** The scattered cloud field was built and then removed.
- **The roster's progress bars are back** beside each racer's dot.
- **Blur is back on the background layers.** The race's city and the menu's far city take the sky's soft refraction, which gives the skyline its glow. The sharp-skyline pixel test is retired.
- **Open:** the menu stillness e2e tests ("low quality is static" and "reduced motion freezes the frame") fail when other specs run in parallel, and pass alone (the frames compare identical). This looks like load or timing, not motion. It is left open.
- **Open:** the user saw the race's sun (a mint disc) and clouds behind the menu in one session. It hasn't reproduced; the path taken is needed.
