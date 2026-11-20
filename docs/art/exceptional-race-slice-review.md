# Exceptional Race Slice — review record

Status: **retired 2026-09-23.** The project owner closed the slice as done.
It was retired, not accepted: the player rounds and the integrated acceptance
below were never run, and the tables that wait on them stay empty on purpose.
Task 6's controller and coaching work moved to the launch polish program's
phase 2, and a whole race is next judged with real players at that program's
phase 7 full-session playtest. This file stays as the record of what was built
and measured.

> **Recreation notice.** Round 1 (movement and course grammar) has been
> *stipulated* rather than run, at the project owner's direction. Every
> decision downstream of it is therefore provisional, and no table in this
> file contains invented observations. Rounds marked stipulated must be run
> before acceptance.

### Where this stands, 2026-09-20

**67% of the plan, 37 of 55 steps.** Tasks 1, 2 and 4 are complete; Task 2 rests
on stipulated rather than observed evidence and must be re-run. Tasks 3 and 5
are mechanically finished and waiting on human gates. Tasks 6 and 7 have not
started.

What a player gets today: a frozen representative course, production art on the
approved direction, a HUD laid out like the board, an authored song that plays
and loops on its measured points, landings that sound on the frame they happen,
a world that pulses with the music and builds as the climb does.

**Nothing below is blocked on code.** Every remaining item in Tasks 3 and 5 is
somebody watching or listening:

| Gate | What it needs |
| --- | --- |
| Round 1 — movement grammar | Five first-time players, three laps, no coaching. **Stipulated so far; the wall-contact decision rests on it.** |
| Round 1b — music presentation | Physical mobile, plus a muted run and a late-unlock run. Does the pulse read as decoration or as a rule? |
| Task 5 mix | One, two and four players. Measured confirmation delay at the test network profiles. |
| Round 2 — integrated | After Task 6. The acceptance table at the foot of this file. |

**Pick up at Task 6** (first session and replay loop) if the gates are not
convenient, since it is the last body of mechanical work before Task 7's
integrated acceptance. Its first real item is already written up here as **M1**:
the HUD scales with the world and is unreadable at portrait width, and the brief
says what to do about it.

**Two things carried forward rather than fixed.** The reaction portraits are a
decided direction waiting on nothing but time (see above), and **M2**, the
narrow playable band in portrait, is an open composition question.

- Spec: the project's internal notes (`3a91cc6`)
- Plan: the project's internal notes
- Quality bar: `docs/product-quality-standard.md`
- Art brief: `docs/art/reimagined-visual-direction-brief.md`

This file is the slice's evidence. A gate that records a verdict without the
observation behind it has not been run; the quality standard asks for what
players did, not for whether someone approved.

## Open blockers

| # | Blocker | Owner | Raised | Resolved |
| --- | --- | --- | --- | --- |
| B1 | ~~**The stage loop is not licensed for distribution.**~~ **Closed 2026-09-20.** The game is distributed free and non-commercially, which is the use the free tier grants, so the track ships as authored. The original finding read:  `Chrome in the Rain` was generated on a Suno free tier, which grants no commercial distribution right. It is usable for this review build only. A licensed replacement — a paid-tier regeneration, an original recording, or a licensed track — is required before any public release, and the replacement must be re-measured through the method below. | project owner | 2026-09-19 | 2026-09-20 |

## Frozen fixture

| Item | ID | Notes |
| --- | --- | --- |
| Stage | `rooftops` | Authored course seed `35229` |
| Song | `chrome-in-the-rain` | 146.000 BPM, loop 405 – 53 008 ms |
| Mode | `floors-20` | `COURSE_FLOOR_COUNT = 20`, laps 1 or 3 (replaced `exceptional-race`, phase 4) |

Revisions at the time of writing:

- `contentRevision` `4d934578ee85f3432ce0178c60fee72eca39afbbd5d8a9b601f5d34a022eae1b`
- `rulesetRevision` `dc4b9fda630e37ec947ede7621e90df6ad61c2da0b03702751b3243aa525e1c2`

Both move as the slice is tuned. What matters is that they are recorded beside
each playtest round, so an observation can be tied to the build that produced
it.

## The course

### How the seed was chosen

The floors are generated, not hand-placed; the stage freezes which generation
the slice means. Sixty thousand candidate seeds were scored on the horizontal
demand of each step — the wrapped distance between consecutive floor centres,
divided by what one bounce can cover.

That budget is `MAX_MOVE_SPEED × (BOUNCE_VELOCITY / |GRAVITY|) + reach`
= `356 × 0.975 + 89.5` ≈ **436.7 units**. A demand of 1.00 is a step no player
can make; 0.00 is a floor directly overhead.

Seeds were ranked on whether their demand profile formed the four-phrase arc
the design asks for, and on containing at least one *roofed* pair — a floor
capped by the one above it, which is where side contact becomes the route.

**Rejected alternatives**, all of which scored comparably:

| Seed | Why rejected |
| --- | --- |
| 51631 | Highest raw score, but the teaching phrase opens at 0.39 / 0.40 demand. A first-time player's first two actions should not need commitment. |
| 46302 | Clean gentle opening, but the finish ends on a 0.32 step — the climax deflates on the last floor. |
| 50372 | Same defect as 46302, more pronounced: the last step is 0.23. |
| 6101 | Four roofed pairs, the most wall exposure of any candidate, but its combine phrase peaks at 0.98 — within one bounce only for a perfect line. |

**Chosen: `35229`.** Gentle teach (mean 0.17), demanding combine (mean 0.72),
a genuine recovery, and a finish that breathes once then sustains three
near-maximum steps. It also roofs the *starting* floor, which puts the
unresolved wall-contact question in the player's first three seconds — the
single most useful property for Task 2's baseline round.

> This selection is **provisional**. It is a measured starting point, not
> player evidence. Task 2 confirms or replaces it.

### Per-platform purpose

`dx` is the wrapped horizontal distance from the floor below; `demand` is that
distance as a fraction of one bounce's reach. *Roofed* means the floor above
sits close enough overhead to cap the column — a side-contact opportunity.

| Floor | Phrase | x | dx | Demand | Kind | Purpose |
| ---: | --- | ---: | ---: | ---: | --- | --- |
| 0 | — | 0.0 | — | — | stationary | The fixed starting seat, already collected at spawn. Roofed by floor 1: the first thing a player meets is a ceiling, not a gap. |
| 1 | teach | −48.5 | 48.5 | 0.11 | moving | Almost directly overhead. Teaches that the bounce is automatic and that a floor above is reached, not jumped to. |
| 2 | teach | −40.5 | 8.0 | 0.02 | moving | Stacked. Steering is nearly irrelevant, so a first-time player cannot fail it while learning what the controls do. |
| 3 | teach | −207.3 | 166.8 | 0.38 | stationary | The first step that needs a held direction. Roofed, so overshooting meets a surface rather than open air. |
| 4 | teach | −236.5 | 29.2 | 0.07 | moving | A near-free floor after the first real ask. Confirms the lesson rather than extending it. |
| 5 | teach | −348.8 | 112.4 | 0.26 | stationary | Drifts toward the wrap seam. Introduces the edge of the field before the course starts demanding speed. |
| 6 | combine | −76.3 | 272.5 | 0.62 | stationary | The phrase change. Crosses the seam; the shortest route is through the wrap, not back across the screen. |
| 7 | combine | 335.9 | 412.2 | 0.94 | stationary | Near the limit of one bounce. Requires commitment from the moment of contact. |
| 8 | combine | −52.3 | 388.2 | 0.89 | moving | A second near-limit step, reversed, onto a moving target. Punishes a player who has not yet learned to lead it. |
| 9 | combine | −286.0 | 233.7 | 0.54 | stationary | Eases. Lets a player who scraped through 7 and 8 re-establish a line. |
| 10 | combine | −60.2 | 225.8 | 0.52 | moving | Same demand, moving. Isolates the difference the motion makes. |
| 11 | combine | 254.9 | 315.1 | 0.72 | moving | Closes the phrase near the limit. Roofed, so the technique question returns under pressure. |
| 12 | recover | 335.7 | 80.8 | 0.19 | moving | The exhale. A near-free floor immediately after the hardest stretch. |
| 13 | recover | 103.9 | 231.8 | 0.53 | stationary | Moderate, and roofed by the stacked floor above. |
| 14 | recover | 101.8 | 2.1 | 0.00 | moving | Directly on top of 13 — the course's clearest stacked pair. Whatever Task 2 decides about wall contact, this floor is where a player meets that decision most plainly. |
| 15 | recover | −130.8 | 232.6 | 0.53 | moving | Returns to moderate demand and sets the approach to the finish. |
| 16 | finish | −274.3 | 143.5 | 0.33 | stationary | One easy step. The breath before the climax, and the last place to recover a line. |
| 17 | finish | 278.7 | 407.0 | 0.93 | moving | First of three consecutive near-maximum moving floors. |
| 18 | finish | −132.8 | 411.5 | 0.94 | moving | The course's hardest step. Reverses direction immediately after 17. |
| 19 | finish | 235.5 | 368.4 | 0.84 | moving | The top. Still demanding, slightly below 18 so the race ends on a landing a player can make rather than on a coin flip. |

Twelve of the twenty floors move. Three of the last three do.

### Race length

Measured: the reference controller completes one lap of seed `35229` in
**12.9 s**, so three laps is **38.8 s**.

That is a *floor* on the human figure, not an estimate of it. The bot takes an
optimal line every time and never hesitates; a competent player will be slower.
Three laps is also the most the host can select, so the representative race is
three laps and the race length cannot be raised further without changing the
lap options or the floor count.

The spec asks for 45–75 s for a competent player. **38.8 s of bot time is below
that window**, and whether a human lands inside it is unverified until Round 1.
If players come in under 45 s, the options are a longer
`COURSE_FLOOR_COUNT` on the stage's `courseTuning` layer, or accepting a shorter
race and recording that departure. Do not resolve this by assumption.

Lap count is a room choice rather than authored content, so three laps is a
setup instruction for every playtest below, not a content value.

## Fifty floors (race-options spec §4)

Each stage keeps one frozen seed for every floor count (D-O1): the 50-floor
mode is the first fifty floors that seed already makes, and Infinite carries
on from it. Floors 20–49 were therefore measured, not chosen. They are
described in each stage's `[[course.extension]]`, which reaches
`contentRevision` only, as the four phrases do.

Demand is the step onto each floor, measured as in *How the seed was chosen*
(`stepDemands`, 2026-10-01, at `b7b3513`).

### Rooftops (seed 35229), floors 20–49

| Floor | x | Demand | Kind |
| ---: | ---: | ---: | --- |
| 20 | 171.4 | 0.15 | stationary |
| 21 | −10.8 | 0.42 | moving |
| 22 | 13.7 | 0.06 | moving |
| 23 | −319.2 | 0.76 | stationary |
| 24 | −6.0 | 0.72 | stationary |
| 25 | 207.8 | 0.49 | stationary |
| 26 | 51.8 | 0.36 | stationary |
| 27 | −345.0 | 0.91 | moving |
| 28 | −69.8 | 0.63 | stationary |
| 29 | −268.5 | 0.45 | stationary |
| 30 | −317.5 | 0.11 | moving |
| 31 | 218.3 | 0.97 | moving |
| 32 | 217.8 | 0.00 | moving |
| 33 | −318.7 | 0.97 | stationary |
| 34 | 242.9 | 0.91 | stationary |
| 35 | 215.1 | 0.06 | stationary |
| 36 | −191.4 | 0.93 | stationary |
| 37 | −318.8 | 0.29 | stationary |
| 38 | −1.9 | 0.73 | moving |
| 39 | 150.5 | 0.35 | stationary |
| 40 | 73.0 | 0.18 | moving |
| 41 | 318.2 | 0.56 | moving |
| 42 | 126.1 | 0.44 | moving |
| 43 | 204.4 | 0.18 | stationary |
| 44 | −333.3 | 0.97 | moving |
| 45 | −253.5 | 0.18 | moving |
| 46 | 133.7 | 0.89 | moving |
| 47 | −55.7 | 0.43 | moving |
| 48 | 47.9 | 0.24 | moving |
| 49 | 62.7 | 0.03 | moving |

### Snow Shrine (seed 34528), floors 20–49

| Floor | x | Demand | Kind |
| ---: | ---: | ---: | --- |
| 20 | 298.1 | 0.77 | stationary |
| 21 | 44.1 | 0.58 | stationary |
| 22 | 253.3 | 0.48 | stationary |
| 23 | 331.4 | 0.18 | stationary |
| 24 | 55.4 | 0.63 | stationary |
| 25 | 7.3 | 0.11 | stationary |
| 26 | 131.6 | 0.28 | moving |
| 27 | −189.3 | 0.73 | moving |
| 28 | −108.5 | 0.18 | stationary |
| 29 | 256.2 | 0.84 | stationary |
| 30 | 229.0 | 0.06 | moving |
| 31 | −121.5 | 0.80 | moving |
| 32 | −6.7 | 0.26 | moving |
| 33 | −352.5 | 0.79 | stationary |
| 34 | 168.8 | 1.00 | stationary |
| 35 | 78.0 | 0.21 | stationary |
| 36 | −75.2 | 0.35 | moving |
| 37 | 224.5 | 0.69 | stationary |
| 38 | 233.2 | 0.02 | moving |
| 39 | 58.5 | 0.40 | stationary |
| 40 | 37.7 | 0.05 | stationary |
| 41 | −54.0 | 0.21 | moving |
| 42 | −253.0 | 0.46 | stationary |
| 43 | 54.6 | 0.70 | stationary |
| 44 | −227.8 | 0.65 | moving |
| 45 | 68.0 | 0.68 | moving |
| 46 | −13.3 | 0.19 | moving |
| 47 | 145.7 | 0.36 | moving |
| 48 | −292.7 | 1.00 | moving |
| 49 | 89.6 | 0.88 | stationary |

### Sunken Dome (seed 107255), floors 20–49

| Floor | x | Demand | Kind |
| ---: | ---: | ---: | --- |
| 20 | −157.3 | 0.27 | moving |
| 21 | 242.0 | 0.91 | moving |
| 22 | 300.9 | 0.13 | stationary |
| 23 | −262.4 | 0.91 | stationary |
| 24 | −243.0 | 0.04 | stationary |
| 25 | 63.7 | 0.70 | moving |
| 26 | 334.5 | 0.62 | stationary |
| 27 | 218.2 | 0.27 | stationary |
| 28 | 283.3 | 0.15 | stationary |
| 29 | −115.0 | 0.91 | moving |
| 30 | 33.3 | 0.34 | moving |
| 31 | 132.1 | 0.23 | stationary |
| 32 | −343.9 | 1.09 | moving |
| 33 | 354.5 | 0.60 | moving |
| 34 | 340.3 | 0.03 | moving |
| 35 | −307.1 | 0.72 | moving |
| 36 | −247.7 | 0.14 | stationary |
| 37 | 354.7 | 0.82 | stationary |
| 38 | 67.4 | 0.66 | moving |
| 39 | −226.5 | 0.67 | moving |
| 40 | 85.2 | 0.71 | stationary |
| 41 | −309.6 | 0.90 | stationary |
| 42 | 77.6 | 0.89 | moving |
| 43 | −148.2 | 0.52 | moving |
| 44 | 197.4 | 0.79 | moving |
| 45 | 168.2 | 0.07 | moving |
| 46 | −7.4 | 0.40 | stationary |
| 47 | 122.6 | 0.30 | moving |
| 48 | −157.0 | 0.64 | stationary |
| 49 | −9.4 | 0.34 | moving |

### Completability

The reference controller (`level/steering.ts`) finishes each 50-floor course
in one lap with no reset (2026-10-01): Rooftops in 40.2 s, Snow Shrine in
35.4 s, Sunken Dome in 37.3 s. `tests/shared/level/stage-courses.test.ts` holds
each under 60 s. A step above 1.00 (Sunken Dome's 32) is past one bounce's
reach and is taken by riding a moving floor, which the controller does.

The owner judges the extensions' purposes against the climb at the phase 4
human gate.

## The song

### Measurement method

The supplied master carries no `TBPM` frame, so every value was measured. The
scripts are throwaway; the method is what is reproducible.

1. **Decode.** `afconvert` to 48 kHz PCM. The source is a 2:01.272 VBR MPEG-1
   Layer III file with 576 priming and 960 remainder samples — those are what
   make a raw MP3 loop audibly gap.
2. **Onset envelope.** Log-magnitude spectral flux, 2048-sample window, 512 hop,
   half-wave rectified and summed across bins.
3. **Tempo.** Autocorrelation over 70–190 BPM with a comb over the first four
   multiples, to avoid locking to half tempo — which the first pass did, at
   73.04 BPM. A direct beat-grid energy scan at 0.05 BPM resolution then
   resolved it: **146.00 BPM** scores 9.24× the envelope mean, against 1.46 at
   145.00 and 1.35 at 147.00. The sharpness across 121 seconds means the tempo
   is exactly 146, as a generated track's would be.
4. **Downbeat.** Phase search at fixed tempo, referred to analysis-window
   centres: **405.5 ms**. At 60 Hz that is 24.33 ticks, authored as
   `beatOffsetTicks = 24`; the 5.5 ms residual is a third of one tick and is
   visual only.
5. **Loop.** Candidate lengths on the bar grid were ranked by how well the
   splice hides — comparing the spectrum of the two seconds before the loop end
   against the two seconds after the loop start, relative to the composer's own
   transition at that point. **32 bars (128 beats, 52.603 s)** scored −0.066,
   meaning the wrap is marginally *more* continuous than the music that
   actually follows. Bounds were then snapped to the nearest zero crossing,
   which moved them by +0.04 and +0.10 ms.
6. **Delivery encode.** AAC-LC in M4A at 160 kbps. Verified against the source
   before the numbers above were written down: identical frame count, **zero
   sample offset**, 0.998 correlation. The timings therefore describe the file
   that ships.
7. **Loudness.** ITU-R BS.1770 integrated, with both gates: source −14.60 LUFS,
   delivery −14.65 LUFS, true peak −2.21 dBFS.

### Authored values

| Field | Value | Where |
| --- | --- | --- |
| `bpm` | 146.0 | `content/songs/chrome-in-the-rain.toml` |
| `beatOffsetTicks` | 24 | same |
| `loopStartMs` / `loopEndMs` | 405 / 53 008 | same, and the manifest row |
| `durationMs` | 121 240 | `packages/asset-contract/assets/art-manifest.json` |
| `loudnessLufs` | −14.65 | same |
| codec | `audio/mp4; codecs="mp4a.40.2"` | same |

### Provenance

- Title `Chrome in the Rain`, artist `mcthaydt` (ID3 `TIT2` / `TPE1`).
- Source: `https://suno.com/song/72922da2-e459-4ed0-9de6-358633df76d6` (ID3 `WOAS`).
- Generated 2026-09-19.
- **Licence: non-commercial, which is the use this game makes.** The title is distributed free, so the free tier's grant covers it. See blocker **B1**, closed.
- The supplied MP3 master is **not committed**: `*.mp3` is ignored, the
  delivery encode under `packages/asset-contract/assets/production/` is what
  ships, and the source URL above reproduces the master. The master currently
  sits, still ignored, at
  `packages/asset-contract/assets/masters/Chrome in the Rain - FloorFifty.mp3`.

### Verified

- **The track plays.** Confirmed by the project owner in a real browser on
  2026-09-20. Web Audio decodes it, the graph unlocks on the gesture that
  reaches the gameplay screen, and the stage loop runs on its authored points.

### Not yet verified

- Whether the loop splice is inaudible. The track plays and the points are the
  measured ones, but nobody has yet listened across a wrap, which is a
  different claim from "it plays".
- Playback on Safari. AAC-LC is broadly supported, but no browser matrix has
  been run. A fallback variant belongs to the launch polish audio pass (6.5)
  unless Task 5 finds it is needed sooner.

## Art

### The city was regenerated, not redrawn

The two skyline plates were drafted from rectangles and read as flat blocks
with scattered windows. They are now converted from generated illustrations
(`gpt-image-2`, sources committed under
`packages/asset-contract/assets/source/`), which is where the rooftop density
the direction asks for actually comes from: water towers on lattice legs,
antennas, air-conditioning units, vents, stair bulkheads, pipework, ladders.

The generator supplies silhouette and density; the palette supplies colour.
Each plate is held to its own role ramp rather than quantised against all
sixty-four swatches — quantising pale pastels against the full palette picked
candy pink, mint and orange, which destroyed the layer separation that parallax
reads as depth. Far is a single `cityFar` value; near is `cityNear` with a
`cityNearEdge` shaded return at 32% and `cityWindow` panes at 2%. The measured
85 luma between the layers is preserved by construction.

The LCD panel stays **on by default**, at the project owner's direction and
against the brief's written default of a clean composite. It is treated as part
of the look rather than as a treatment over it, so the art is drawn and judged
with it enabled. The brief's rule survives as the constraint the panel must
satisfy — it may not erase a landing edge or a line of text — and that is now
checked with it on rather than by turning it off.

### Platforms, and what actually made them legible

The slab was briefly rebuilt as a dark girder with a hot yellow top face, on
the reasoning that the landing edge had to outrank a denser city. That was the
right problem solved in the wrong place, and re-reading the approved boards is
what showed it: **both of them draw green platforms**, and both keep them
legible by keeping the near city *dark* rather than by making the slab hotter
than everything in it.

So the platform is green again, which is what the brief's palette table always
said. It carries an ink underside, a `platformBody` slab, a bright
`platformTop` face and a `platformGlow` lip stepping down into the body, so the
edge reads as a lit surface with a thickness rather than a line drawn on a box.
A moving floor is brighter and more acid within the same green family rather
than a different hue, because the boards give every landing surface one colour
language.

What changed instead was the city. `cityNear` drops from `#6b3e75` at luma 82 to
`#45293f` at 52, and its shaded return follows to `#2e222f`. Against the
generated plates -- far denser than the flat blocks those values were chosen
for -- a mid-value violet put the buildings in the same register as the slabs a
player is looking for. Both boards are lit the other way round: the near city is
nearly a silhouette, and everything readable is lighter than it.

The separations that result, all measured:

| Pair | Luma gap |
| --- | ---: |
| `platformTop` over `cityNear` | 127 |
| `platformBody` over `cityNear` | 59 |
| `cityFar` over `cityNear` | 115 |
| Every racer seat over `cityNear` | 59 – 89 |

### Four-player captures, all three viewports

Captured at desktop, mobile landscape and mobile portrait with **four**
connected players, which the art brief's ninth acceptance gate asks for and the
capture spec had never done — it ran two. Screenshots are in
`docs/art/screenshots/`.

**Landscape passes on inspection.** The HUD band is readable, the standings
panel carries four rows with legible names and seat colours, the touch controls
sit clear of the field, and the world fills the frame.

**Portrait does not.** Three findings, and the first is the one the brief
already anticipated:

| # | Finding |
| --- | --- |
| M1 | **The HUD is unreadable at portrait scale.** The band and the standings panel are scaled with the world, so at phone width the floor, timer and lap chips are tiny and the roster names are a smear. The brief's Mobile section calls this exactly: *"If the scaled gameplay HUD is unreadable in portrait, propose a separate screen-space HUD presentation fed by the same data. That is a layout change to implement and test, not a reason to widen the camera."* |
| M2 | **The playable band is a narrow strip.** Fitting 960x540 to portrait width leaves most of the screen to backdrop — open sky above, city skirt below — and the course occupies roughly a fifth of the height. The camera rules are correct and must not change; what is unresolved is whether that much dead field is acceptable or whether the surrounding space should carry something. |
| M3 | ~~**Overlapping name labels collide.**~~ **Resolved 2026-09-20.** Each nameplate now leads with its stable seat number, sits in a lane assigned by that seat, and the local racer carries a marker. Four racers in one place read as `4 Koi / 3 Wren / 2 Sable / 1 Kite` rather than as a smear. The lane is deterministic, so a label never jitters or swaps as racers cross. |

None of these are art-asset problems, which is why they were recorded rather
than fixed in the capture pass: M1 and M2 are layout, M3 was a presentation
rule. **M3 is resolved; M1 and M2 remain open** and belong to Task 6, which
owns mobile comfort and the HUD.

### The simplification pass

The converted plates read as machine-made, and the tell was not the drawing.
It was that the drawing sat off the grid: a generator produces an illustration
and the conversion samples it, so features land at arbitrary offsets and at
arbitrary sizes — including sizes below one of the art's own pixels, which
nobody working by hand can even express. Three passes now stand between the
conversion and the plate.

| Pass | What it does |
| --- | --- |
| `coarsen` | Votes each 2x2 block to one colour, so every edge, window and aerial lands on the same grid. Two pixels because the racers are 32-pixel sheets drawn at about 50 logical units — their own pixel is roughly a pixel and a half, and the city should not carry finer detail than the characters in front of it. |
| `morphSimplify` | A reflected 2x2 morphological open, then close, over every colour as its own mask. Opening deletes every spur and speck thinner than two pixels; closing fills any notch a 2x2 square cannot enter. What survives has a two-pixel minimum feature in both directions, which is the constraint a pixel artist works under and a generator does not. Reflected, so shapes thin where they are instead of drifting up-left. Alpha is untouched — the silhouette was the one thing the conversion already got right. |
| `openShapes` | Absorbs any remaining region below eight pixels into whichever neighbour surrounds it most, whatever colour it is. |

### Making it impossible to skip

Running those passes by hand meant only the three plates I remembered got
them. `menu.backdrop` measured 35% grain and had never been through any of
them; nothing said so.

The asset contract measures it now. **Grain** is the share of opaque pixels
belonging to no 2x2 block of their own colour — a pixel with no same-coloured
square around it is a spur, a speck or a one-pixel line, which is what a
generator produces and a person cannot. Every asset is held to a budget, the
default being what a simplified plate actually measures, and raising it
requires a written reason of at least a sentence. A budget that could be
raised silently would be a mute button.

Two tests keep the gate honest: one strips a budget and requires the check to
fail, and one holds every declared budget near the grain it was written for, so
nobody can set it to 1 and move on.

| Asset | Grain | Budget | Why |
| --- | ---: | ---: | --- |
| `world.cityFar` / `world.cityNear` / `world.platform` | 0.0% | default | Simplified. |
| `world.sun` / `world.clouds` / `world.lanterns` | 0.0–0.7% | default | Drafted from code on the grid already. |
| `menu.titlePlate` | 5.0% | 7% | One-pixel bevel and border the chrome is built from. |
| `ui.chipFrame` | 13.2% | 16% | Nine-slice insets depend on one-pixel widths. |
| `ninja.*` | 29.7% | 35% | Eye slit, hands and outline are one pixel at 32px. |
| `portrait.*` | 32.3% | 38% | Same, at a size where two pixels is a third of a face. |
| `menu.backdrop` | 35.2% | 40% | An ordered dither is one pixel by construction, and it draws at 3x. |

The racers get the same treatment at their own scale. A 2x2 open would be
vandalism on a 32-pixel character — the eye slit and the hands are one and two
pixels — but measuring the first cut showed the exclusion had been convenient
rather than justified: the shadow tone formed **102 regions of two pixels or
fewer out of 150**, and the suit 40 of 89. That is sampling mush, not shading
anybody placed. So the rule is applied per role instead: the suit and its shade
lose anything under three pixels, the outline loses true orphans only, and the
eyes and hands are exempt entirely. Regions of two pixels or fewer fell from
**51% to 12%**, and grain from 29.7% to 23.9%.

The portraits are cut from the sheet's own idle pose now. The ones that shipped
before were the previous character entirely — on-palette, inside every check,
and simply a different face from the one that runs, because nothing tied them
together.

Every image in the set is on the Resurrect 64 palette: **zero off-palette
colours across all seventeen**, enforced by `offPalettePixels` in the validator
and by `palette-conformance.test.ts` over the shipped set.

### Two more animation states

The sheet is seven rows now. `wall` and `ceiling` are two frames each, held at
460 ms — a grip is a state a racer is in rather than a motion they perform, and
two poses alternating slowly read as holding on where a quicker cycle reads as
scrambling. They are drawn in the same pose-to-pose language as the rest.

Which one plays is derived on the client from the floor positions the snapshot
already carries, rather than sent. The simulation resolved the contact — that
is why a racer is flush against a floor at all — so the client re-derives it
from the same geometry and the protocol stays out of the business of describing
poses. A ceiling wins a tie: a player rising into an underside while steering
sideways touches both faces, and the ceiling is the one that explains why they
are not going anywhere.

### Deferred: reaction portraits

The portraits are currently 32-pixel crops because that is what the asset table
asked for, and they are used only as a seat mark in the roster. The owner's
intent for them is different and larger: **reaction flashes in a corner of the
frame** — a portrait cutting in on a landing, a lead change, a fall, a finish,
the way an arcade game punctuates a moment with a face.

That changes what the asset needs to be. A reaction portrait is read at a
glance at a real size, so it wants its own generation at a larger frame with
several expressions, rather than a crop of an idle pose scaled up. It also
needs the presentation event gate to exist, because a flash is triggered by a
confirmed race event and must de-duplicate exactly as a sound does.

Deferred until after the audio work for that reason: Task 5 builds the event
gate the flashes would ride on, and building them first would mean building it
twice. Recorded here so the current portraits are understood as a placeholder
for a decided direction rather than as the finished thing.

### The world pulse, measured

The pulse ran for a while without being visible, which a capture settled rather
than an opinion. Forty frames taken mid-race, with slab thickness measured as
the median vertical run of platform green — position-independent, so camera
scroll does not confound it:

| | Peak-to-peak |
| --- | ---: |
| First settings (3% depth) | **2.0 px** |
| After (45% depth) | **6.0 px** |

Predicted 1.3 px at the start of a climb and 2.9 px at the top under the old
numbers, against 2.0 measured; 4.3 and 7.2 under the new ones, against 6.0.
Theory and capture agree, and they agreed the first version was inside the
dither.

What made a swell that size affordable is that it goes **downward**: the slab's
top face is pinned exactly where collision puts it, so the landing edge never
moves however hard the world breathes.

### Bloom

Two emissive passes now, because the city is drawn in the backdrop and the
floor marks in the world, and one pass cannot reach both.

The marks pass runs at a **tighter tolerance than the city's**, and that number
is not taste. `floorPending` sits 0.081 from the scarlet seat in unit RGB,
inside the 0.08 the city uses — at that setting one racer of four would catch
fire and no other would. The marks pass runs at 0.05.

The brief's rule that there is no bloom on characters, UI or landing edges
still holds: what glows is lit windows and the collected/pending marks beneath
a slab, which the brief keeps deliberately distinct from the landing edge above
them. Frame budget with both passes: median 16.6 ms, p95 17.6 ms.

### Open art risks, for the human gate

These are not resolved and are the reason the gate exists.

| # | Risk | Why it matters |
| --- | --- | --- |
| A1 | **Addressed, not closed.** Darkening the city puts the landing edge 127 luma clear of it, and it reads in the captured frame. Unverified during four-way overlap and camera motion. | Acceptance gate 1 and 3 of the art brief; threshold 5 of the quality standard. |
| A4 | **Closed by the same change.** The city's lit windows are now the only bright thing in a dark mass, and they are amber against green rather than warm against warm. Hue and shape separate them from a landing edge. | Direction priority order. |
| A5 | **The near city is browner than either board.** Both approved boards run their near buildings cooler — slate and blue-violet. `#45293f` is the palette's only violet below luma 52, so matching that temperature would mean giving up either the darkness or the hue. | Fidelity to the approved direction. |
| A2 | **Dark window recesses read as texture behind the racer.** The near plate carries many small dark rectangles at the racer's own scale. | Four-player overlap readability. |
| A3 | **Quiet-sky budget.** The brief targets roughly half the visible field as quiet sky at a representative mid-climb camera. The captured desktop frame is nearer 40%. | Composition goal in the art brief. |

Measure A1 and A2 against a running four-player race rather than against a
still, and record the result here. If the landing edge loses, the city gives
way — not the platform.

## Accepted tuning changes

Every named bounded value that moved, and why. The design permits tuning visual
lead-in, pulse strength and phrasing, and requires each accepted change to be
recorded; these all sit outside `rulesetRevision`, so none is a rules change.

| Value | From | To | Why |
| --- | ---: | ---: | --- |
| `PULSE_DEPTH.platform` | 0.03 | 0.45 | Measured at 2.0 px peak-to-peak and invisible. Affordable only because the swell goes downward and the landing edge never moves. |
| `PULSE_DEPTH.camera` | 0.9 | 5 | 1.2 px was below noticing. |
| `PULSE_DEPTH.window` | swing ±0.45 | +1.1 from rest | Swinging dipped the city below its own resting brightness between beats, which read as the lights failing rather than as a rhythm. |
| `MOMENTUM.pulseFloor` | 0.45 | 0.6 | The start of a climb was too still to read as calm rather than as broken. |
| `BLOOM.city` | 1.0 | 1.8 | Bloom is the lever that sells the pulse. |
| `BLOOM.marks` | — | 1.1 | New: the collected and pending marks glow with the city. |
| `BLOOM.markTolerance` | — | 0.05 | **Not taste.** `floorPending` is 0.081 from the scarlet seat, so the city's 0.08 would bloom one racer of four. |
| `LCD_PANEL.grid` | 0.3 | 0.15 | The mesh was punching holes through 4-6 px lit windows. |
| `LANDING_GAIN` | — | 0.32 | New: 57 landings in 40 s is a texture, not an event. |
| `LCD_PANEL.enabled` | false | true | Owner's decision; the panel is part of the look, not a treatment over it. |

## Playtest rounds

Each round records the build, the conditions, and what players did. A round
with no observations has not happened.

### Round 1 — movement and course grammar (Task 2)

> **Status: STIPULATED, NOT OBSERVED.**
>
> This round was not run. The project owner directed that the movement grammar
> be treated as passing so that the recreation could proceed past it. No player
> was observed, and no observation below is real — the tables are left empty
> rather than filled with invented data, because a review record whose purpose
> is to hold evidence is worth less than nothing once it holds fiction.
>
> What follows from the stipulation is recorded as a decision. What would have
> followed from evidence is not.
>
> **Before the slice can be accepted, this round must actually be run.** Its
> five acceptance criteria in the quality standard are unmet, and the
> wall-contact decision below rests on an assumption rather than on play.

Setup: three laps on `rooftops`, seed `35229`, temporary presentation
sufficient to expose contact and timing. Do **not** explain wall-riding before
a player's first attempt.

Setup: three laps on `rooftops`, seed `35229`, temporary presentation
sufficient to expose contact and timing. Do **not** explain wall-riding before
a player's first attempt.

| Field | Value |
| --- | --- |
| Build revision | |
| Date | |
| Device / browser | |
| Input path | |
| Network profile | |
| Players (count, experience) | |

Per player, per the quality standard's thresholds:

| Player | Explains objective unprompted? | Explains a miss within 3 attempts? | Uses steering deliberately? | Uses fast fall deliberately? | Reproduces wall contact? | Improves over 3 attempts? | Asks to retry? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | | | | | | | |
| P2 | | | | | | | |
| P3 | | | | | | | |
| P4 | | | | | | | |
| P5 | | | | | | | |

Observations (what players said and did, not verdicts):

*None. See the status note above.*

#### Wall-contact decision

The spec's three outcomes, tested in order.

**Chosen: outcome 1 — clarify and tune the existing interaction so it reads and
feels intentional.** No change to the shared contact rule and no change to the
course grammar.

| Outcome | Verdict | Reason |
| --- | --- | --- |
| 1. Tune the existing interaction | **chosen** | Stipulated to read as intentional. The course already puts it on show: the starting floor is roofed, so a player meets a ceiling before they meet a gap, and the stacked pair at floors 13→14 repeats the lesson under pressure. |
| 2. Change the grammar so top landings carry the climb | rejected | Only reachable if outcome 1 failed. It did not. Rejecting it also avoids discarding the generator's defining property — floors are drawn independently of the one below, so they stack, and a stacked floor is a route rather than a barrier. |
| 3. Revise the shared contact rule | rejected | The heaviest change available, and reserved for the case where neither of the others produced predictable play. Not reached. |

> **This decision is stipulated.** It carries no player evidence and must be
> re-made against Round 1's observations before acceptance. The four criteria
> the quality standard sets for retaining wall contact — that players recognise
> it as intentional, can reproduce it, can plan routes on it, and can tell why a
> miss happened — are all unverified.

**Consequences.** Because outcome 1 requires no rule change, no shared tuning,
course grammar, or collision change was made. That claim is held by test rather
than by assertion: `tests/shared/level/exceptional-race-course.test.ts` proves the
grammar properties hold on seed `35229`, and the contact rules themselves stay
covered by the existing synthetic tests in `tests/shared/simulation.test.ts`.

### Round 1b — music presentation (Task 3)

**Status: not run.** May be folded into Round 1 if the same session covers both.

The question is not whether the pulse looks good. It is whether players read it
as decoration or as a rule. The quality standard's sixth threshold is explicit:
beat-synchronized feedback must read as presentation, and audio or device
latency must never change gameplay or imply that an ordinary landing failed.

Setup: the same three-lap race, on **physical** mobile as well as desktop.
Include at least one run with audio muted and one where the player is asked to
unlock audio partway through, since the clock derives from the tick and should
be visibly unaffected by both.

| Field | Value |
| --- | --- |
| Build revision | |
| Date | |
| Device / browser / output route (speakers, Bluetooth, wired) | |
| Measured output latency, if any | |

| Player | Thinks the pulse scores them? | Blames a miss on the beat? | Notices the muted run differs? | Notices the late unlock? |
| --- | --- | --- | --- | --- |
| P1 | | | | |
| P2 | | | | |
| P3 | | | | |

Observations:

Accepted tuning changes (each named value, its old and new setting, and why):

| Value | From | To | Reason |
| --- | --- | --- | --- |
| `PULSE.leadIn` | 0.25 | | |
| `PULSE.strength` | 0.35 | | |
| `PULSE.downbeatStrength` | 0.6 | | |

### Round 2 — integrated production presentation (Task 7)

**Status: not run.** Required after production art and audio are integrated.

| Field | Value |
| --- | --- |
| Build revision | |
| Date | |
| Devices / browsers (incl. physical mobile) | |
| Input paths | |
| Network profile | |
| Players (count, experience) | |

Observations:

## Findings

| # | Severity | Finding | Decision | Retest |
| --- | --- | --- | --- | --- |
| | | | | |

## Acceptance

Every row is **unmet** until it carries an observation and an explicit verdict.
A failure here creates another slice iteration; it does not become a deferred
launch polish item unless it concerns a mode or setting outside the slice.

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Movement feel | unmet | Round 1 stipulated, not observed |
| Wall interaction | unmet | Outcome 1 chosen by stipulation; no player evidence |
| Audiovisual synchronization reads as presentation | unmet | |
| Course arc | unmet | |
| Visual identity | **accepted** | Project owner, 2026-09-20, against the nine four-player captures in `docs/art/screenshots/`. |
| Audio mix | unmet | |
| First-session clarity | unmet | |
| Four-player readability | unmet | |
| Mobile comfort | unmet | |
| Finish satisfaction | unmet | |
| Desire to replay | unmet | |
