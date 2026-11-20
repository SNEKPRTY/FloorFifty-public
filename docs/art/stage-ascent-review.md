# Stage Ascent — review

Date: 2026-10-01

Plan: 2026-09-30-stage-ascent.md
Spec: 2026-09-30-stage-ascent-design.md
Boards: [2026-10-01-stage-ascent/](explorations/2026-10-01-stage-ascent) (Snow Shrine, Sunken Dome); Rooftops against [extended-stage.png](explorations/2026-09-20-refinement/extended-stage.png)

## Status

**Accepted by the owner on 2026-10-01** — "Looks good to me", given after the
after set, the powdery finish on all three stages and the phone-portrait bar
were shown. A blanket acceptance of the stages, recorded as such.

| | |
| --- | --- |
| **Automated pass** | Unit and integration suites, typecheck, build, content and asset contracts, desktop browser suite: green on the Windows runner (run 36821103430) and locally after every later change (2347 tests, 4 skipped). |
| **Frame budget** | **Passing on every stage, at both graphics settings.** See below. |
| **Agent visual inspection** | Done. Before and after sets read at native size against each board panel; observations per stage below. |
| **Owner visual approval** | Boards approved 2026-09-30 ("yes"). Beds approved 2026-10-01 ("sounds fine"). Stages accepted 2026-10-01 ("Looks good to me"). |

## Evidence

- **Before:** `screenshots/stage-ascent/before/` — the four phrases of all three
  stages on desktop, captured on the Windows runner from 4212cf9 before any art
  changed; Rooftops and Sunken Dome on phone portrait, phone landscape and tablet
  portrait. Snow Shrine's device frames are omitted: that run already carried its
  new art.
- **After:** `screenshots/stage-ascent/after/` — the same 21 frames. First
  captured locally on the Mac at the owner's request ("do it locally") while the
  shared Windows runner was occupied; recaptured on the Windows runner on
  2026-10-01, after Rooftops' three cloud bands (`8001796`) and Sunken Dome's
  lip crop, from `fix/phase-2b-audit`: runs 36842582247 (phone portrait),
  36846339471 (tablet portrait), 36847562652 (phone landscape) and 36848327371
  (desktop phrases).

## Frame budget

`frame-budget.spec.ts`, per stage, on the Windows runner (run 36834245781, on
`fix/phase-2b-audit` with Rooftops' three cloud bands, the powdery finish, the
phone bar and song select merged), over the four budget viewports. Ceiling:
p95 < 33.4 ms.

| | Median | p95 |
| --- | --- | --- |
| Menu refraction | 17.6–17.9 ms | 18.6–19.2 ms |
| Rooftops, default / low | 17.5–17.7 ms | 18.8–20.5 ms |
| Snow Shrine, default / low | 17.5–17.8 ms | 18.7–20.1 ms |
| Sunken Dome, default / low | 17.5–17.7 ms | 18.6–20.3 ms |

No per-layer quality field was needed (spec §7.3). Rooftops' two extra cloud
bands add two sky draws and stay well inside the ceiling. The first
measurement, before those changes, was run 36821103430.

On the final head (391a9e9), with the shared Windows runner queued behind other
branches, the owner had the budget run locally on the Mac (Apple M1, load
about 3): all 24 pass. The Mac's numbers are not the runner's, but they bound
the same change.

| Final head, Mac | Median | p95 |
| --- | --- | --- |
| Menu refraction | 16.6–17.6 ms | 17.7–19.0 ms |
| Rooftops, default / low | 16.6–19.6 ms | 17.5–22.4 ms |
| Snow Shrine, default / low | 16.6–17.4 ms | 17.3–19.0 ms |
| Sunken Dome, default / low | 16.6–17.1 ms | 17.5–18.5 ms |

The final head's desktop browser suite, also local: 86 passed, 14 skipped, and
the desktop guard after its baselines moved with the powdered menu (macOS from
the Mac, Windows from the runner's own screenshots; the guard is green on the
runner, run 36846791975).

## Snow Shrine

Matches its board's depth stack: night sky with snowy ridges, the moon, far
peaks and the pagoda, the cedar middle layer, the shrine with its torii and
lanterns, the details strip, and snow at two depths. Its own snow-capped slab
now draws in races (it never had: `PlatformView` read `world.platform` for every
stage). The finish opens to the moon over the peaks.

Deviation kept: the snow on scenery is a pale tone short of white, because white
is the platform's top. Fixed at the owner's request after acceptance: on a tall
phone the sky plate now stands its foot down with the city, so its flat haze
band no longer shows as a white strip between moon and shrine (every stage
benefits), and the moon no longer carries the sun's heat shimmer
(`lightShimmer = false`).

## Sunken Dome

Matches its board: open water with surface light and the far city, mantas and
fish drifting at their own speeds, the spired city, the glass ribs and kelp as
their own layer (they now move against the coral), the coral with portholes, and
its details. Its glass-and-coral slab draws in races. The coral is muted onto
violet-grey and pink and the tubes are unlit, so the portholes are the only
window light. The platform is cropped to its lip, so its coral no longer stands
proud of the landing edge: a solid lip across the top and 83% cover in the top
32 rows, against the plan's 75% (it shipped at 69% until the 2026-10-01 audit).

## Rooftops

| Shortfall (spec §1) | Now |
| --- | --- |
| 1. The climb empties out | **Fixed.** A horizon layer (misted towers on water, arc 0.05) stands above the far towers to the finish. |
| 2. The sky is flat bands | **Fixed.** A sky plate with the board's streaked blue-to-peach, its foot at 200 so the whole gradient is on screen. |
| 3. The clouds are pasted on | **Fixed.** Swept cirrus and low banks; the sun weaves into its glow through the 2-pixel dither and sits just above the horizon. Since `8001796` (owner, 2026-10-01) the clouds drift in three thin bands at three heights (`world.cloudsHigh`, `world.clouds`, `world.cloudsLow`, sinks -330, -140 and 40), so high up no lone stripe crosses the plate's plain top. |
| 4. The near city goes to mush | **Diagnosed, not redrawn.** The plates are crisp at native size; the softness is the filter chain and upscale. Left as a follow-up. |
| 5. Nothing moves | **Improved.** Far birds drift; window flicker was already there. |

## Across all three

- **The powdery finish** (owner, 2026-10-01): AutomataEngine's unfaker
  `simplifySprite` is ported as `powder.ts`, run in each plate's own art pixels,
  on every stage skyline, details strip, prop, horizon, platform and drift band,
  then re-locked to its roles. Dithered skies are left out. Rooftops' near plate
  measures 51/32/18% body/shade/window (was 58/27/15) and 152 windows (was 373).
- **Resurrect 64:** 0 of 5.79 M opaque pixels across the world and still images
  are off the palette.
- **Seams:** every stage strip tiles (seam 0.000 on all but two at 0.005 or
  less), including Rooftops' far, mid and near, which did not before.
- **Phone portrait:** a bar in the palette's black covers only the stretched
  scenery, from where the lowest skyline's skirt starts; tablets and landscape
  unchanged.
- **Ambience:** `ambience.snowShrine` (-25.8 LUFS) and `ambience.sunkenDome`
  (-27 LUFS), level-matched to `ambience.rooftop` (-26).

## Follow-ups for the owner

1. The filter chain's softening of the crisp city (Rooftops shortfall 4).

Done after acceptance, at the owner's request: the powdery finish on the
racers, portraits, menu plates and Dawn (shown as before/after sheets in
`explorations/2026-10-01-powder-everything/` and merged with the Diver's
helmet ring kept solid), and Rooftops' clouds in three bands.
