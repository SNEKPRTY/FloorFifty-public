# Aquarian Beauty Pass — review

Date opened: 2026-09-21

Plan: 2026-09-20-aquarian-beauty-pass.md
Spec: 2026-09-20-aquarian-beauty-pass-design.md

## Status

**Accepted by the user on 2026-09-21.** Automated verification is green except
the frame budget, which fails for a diagnosed reason outside this codebase;
agent visual inspection was done the same day.

Four things are kept apart, because collapsing them is how a beauty pass gets
closed on a green test run:

| | |
| --- | --- |
| **Automated pass** | Typecheck, unit and integration suites, content and asset contracts, build, and the headed browser matrix. All green. See below. |
| **Frame budget** | **Failing, and accepted as such.** Measured and diagnosed, and left failing rather than tuned. See below. |
| **Agent visual inspection** | **Done.** 19 stills and 2 traversals were captured and read at native size. Observations and deviations below. |
| **User visual and motion approval** | **Given, 2026-09-21.** A blanket acceptance of the result, not an item-by-item walkthrough of the seven checks below — recorded that way so the strength of the sign-off is not overstated. |

The plan and the previous record said this machine had no GPU and no display.
That described the machine the pass was *written* on. The machine it was
*finished* on has an Apple M1 and an online display, so the browser gate, the
frame budget and the evidence batch all ran for the first time.

## What is verified

Every command below was run at the tip of this pass, on 2026-09-21.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean (5 workspace projects + the test project) |
| `pnpm test` | **100 files, 994 tests, all passing** |
| `pnpm content:check --verify-artifact` | passes; the artifact's two digests recompute |
| `pnpm assets:check` | **24 assets** validated |
| `pnpm --filter @floor-fifty/client build` | succeeds |
| `playwright test --project=desktop --project=mobile-portrait --project=mobile-landscape` | **53 passed, 4 skipped** (3.4m). The skips are the desktop project skipping the mobile-only touch-control cases. |

`pnpm test` was run three times at this tip. One run failed two tests in a single
timing-sensitive file and the following two runs were green at the same counts;
the failing names were not captured before the output was truncated, so the flake
is recorded as observed and unidentified rather than diagnosed. Nothing in it
reproduced.

### The frame budget

`pnpm test:e2e:budget`, run alone with one worker, measured:

| Viewport | Menu median / p95 | Gameplay median / p95 |
| --- | --- | --- |
| 1280 × 720 | 33.3ms / 34.40ms | 33.3ms / 35.50ms |
| 390 × 844 | 33.3ms / 34.30ms | 33.3ms / 35.40ms |
| 844 × 390 | 33.4ms / 34.20ms | 33.4ms / 35.50ms |

Ceiling: **p95 < 33.4ms**. It fails on all three projects, and the failure is
not the filter chain:

- Every **median is 33.3ms** — exactly two 60 Hz frames — with a p95 within 2ms
  of it. A chain that could not keep up has a healthy median and a long tail; a
  display presenting at half rate has neither.
- **A control measurement settles it.** A page with no canvas, no filters and no
  game paces at the **same 33.4ms median**. `requestAnimationFrame` is delivered
  at ~30 Hz here, so the spec's 60 Hz assumption does not hold on this machine.
- The LCD-off probe the spec prescribes agrees with that reading: with
  `?lcd=grid:0` the *minimum* frame falls from **16.9ms to 5.4ms**, so the chain
  itself fits inside a 60 Hz frame and the panel costs something measurable on
  top of it. That is a lead for whoever next runs this on a 60 Hz display, not a
  verdict.

**No quality level was stepped down and no threshold was moved.** The plan
forbids both, and a gate that reports the display's refresh rate as a shader
problem is worse than a gate that fails and says why.

### What is not verified

- The seven-item human acceptance checklist below. It has been looked at; it has
  not been judged.
- A ten-cycle race-screen enter/exit resource-count probe, a live rotate or DPR
  change, a 3-lap restart in a browser, and the failed-bundle recovery path in a
  browser. Reconnect, race-again and long names are covered by existing suites.
- Contrast at 4.5:1 measured rather than judged. The wordmark's legibility is a
  visual call, below.

## Agent visual inspection

Spec §9 asks for the batch to be read at native size. It was. Three things are
worth a reviewer's attention, and none of them is a defect:

1. **The identity is there.** The menu shows a pearl panel over the dawn sky,
   the stacked Fraunces wordmark in deep ink, four full racer sprites, the spec's
   tagline and a single saturated primary action. The gameplay frame shows the
   dithered dawn sky, the sun, three city layers and the smooth pearl HUD with
   tabular numerals. This is the accepted direction, not the pre-pass interface.
2. **The phrases are true.** The course-phrase captures are taken by polling the
   HUD's own floor counter and photographing the moment it is inside the phrase's
   authored band, so a label cannot disagree with the picture. `teach` reads
   1/20; `finish` reads 18/20 with the sun and clouds *below* the platforms,
   which is what an ascent should look like near the top.
3. **Portrait coverage holds.** The portrait race capture is filled corner to
   corner with scenery — no bars, no letterbox gaps — with the HUD at the top of
   the free scenery above the play rectangle and the touch controls clear of it
   at the bottom. That is the arrangement Task 7 asked for, seen rather than
   assumed.

## Decisions taken that a reviewer should look at first

1. **The wordmark is set in ink, not the board's white/silver.** The menu sits
   on the dawn sky, the lightest surface in the palette. Light type there cannot
   reach the spec's contrast floor, and the previous implementation had already
   chosen dark type for the same documented reason. This is a deliberate
   departure from `aquarian.png` for legibility.
2. **`CityMid` and `rooftopDetails` are roles on existing swatches** — 6 (luma
   119) and 0 — chosen by measurement so the third skyline sits halfway between
   the other two by value. No new swatch was added; the 64-swatch set is intact.
3. **Three assets were retired**: `ui.font` (earlier), `menu.titlePlate` (Task 1)
   and `ui.chipFrame` (Task 7). Each had no remaining caller, and the asset
   contract's "declares no asset the renderer never addresses" rule caught the
   last two.
4. **The HUD's layout styles stay in `RaceHud.svelte`.** The plan's file list
   assumed `aquarian.css`, and Task 7 was carried as deviating from it. On
   inspection the deviation is the repository's actual convention:
   `aquarian.css` holds *shared material* -- its header says so, and
   `.ff-aq-hud` is there -- while every component keeps its own layout in a
   scoped `<style>` block (`Chip`, `ConnectPanel`, `ConnectionIndicator`,
   `TouchControls` all do). Moving the layout global would have broken Svelte's
   scoping for no gain, so the deviation is resolved rather than undone.
5. **The frame budget was left failing.** See above. It is the one automated gate
   that is not green, the cause is the display, and neither a threshold change
   nor a quality step-down was available.

## Evidence

Spec §9's batch, produced in one run by `tests/e2e/aquarian-evidence.spec.ts`
into [docs/art/screenshots/aquarian/](./screenshots/aquarian/): 19 stills and 2
traversals, exactly the matrix the spec lists (4 screens × 3 viewports, 4
desktop course phrases, 3 desktop fallback presentations, 1 normal-motion and 1
reduced-motion traversal).

**The older evidence at `docs/art/screenshots/*.png` is stale.** Those nine
files were last written by `e7de7e6`, 85 commits before this pass, and still show
the pre-Aquarian interface — dark panels and an orange button. Running the matrix
regenerates all sixteen, which is how this was noticed; that churn was reverted
rather than swept into this pass, since the pass's designated evidence folder is
`aquarian/`. **Regenerate or retire them deliberately** with
`npx playwright test --project=desktop --project=mobile-portrait --project=mobile-landscape art-acceptance`.

## Human acceptance checklist

Spec §9. **Checked on the user's acceptance of 2026-09-21.** That was a blanket
sign-off on the result rather than a walk through these seven items one at a
time, and the distinction is kept because it is the difference between "approved"
and "approved, having checked each of these". The agent's own reading of the
evidence is in "Agent visual inspection" above; the judgement is the user's.

- [x] The result clearly matches the accepted Aquarian identity at menu, lobby,
      race and results. — *user, 2026-09-21*
- [x] Gameplay scenery visibly carries the beloved slow refraction; city depth
      remains readable. — *user, 2026-09-21*
- [x] Added layers make the ascent feel richer and more spacious; scenery never
      suggests false landing surfaces. — *user, 2026-09-21*
- [x] Four racers and the next landing edge remain immediately identifiable
      through overlap, wraps and motion. — *user, 2026-09-21*
- [x] The HUD is comfortable to read in portrait and landscape without taking
      control space away. — *user, 2026-09-21*
- [x] There is no distracting optical swim during steering, no visible seam when
      climbing or resetting, and no loss of contrast under the brightest sky.
      — *user, 2026-09-21*
- [x] Reduced-motion and fallback presentations still feel intentional.
      — *user, 2026-09-21*

## Known gaps in the implementation

Recorded rather than smoothed over, and each is also in the plan's execution
log. The first two were **accepted by the user on 2026-09-21** rather than
closed, so they are listed here as open and agreed, not as done:

- The frame budget fails on this machine, for the display-cadence reason above.
  Accepted; not fixed, and not to be "fixed" by moving the threshold or dropping
  the quality level.
- Four browser cases remain unwritten: a ten-cycle enter/exit resource probe, a
  live rotate/DPR change, a 3-lap restart, and the failed-bundle recovery path.
  Accepted as a gap. Reconnect, race-again, long names, font aborts and 200%
  zoom are covered.
- The `menu.titlePlate`, `ui.chipFrame` and `ui.font` retirements changed the
  asset set; `docs/art/resurrect-arcade-brief.md` still lists the retired rows
  as shipped, and has not been rewritten.
- The nine stills at `docs/art/screenshots/*.png` are stale, as described above.

Closed since the previous record: the two scenery plates are the reviewed
generated sources rather than placeholders; the menu backdrop reads the shared
`AmbientClock`; the frozen-presentation swap is asserted through a mounted
screen; the test-only inspection hook exists; the 844 × 390 collision check runs.

## Do not read this as broader acceptance

The acceptance above is of the Aquarian beauty pass and of nothing else. It does
not accept the game or the Exceptional Race Slice, neither of which this pass is
the gate for.

It also should not be read as a green automated suite: **the frame budget is
red**, diagnosed as the display's cadence rather than the filter chain, and
accepted rather than cleared. A later reader who needs that gate to be green has
to run it on a 60 Hz display; this one cannot produce the number.
