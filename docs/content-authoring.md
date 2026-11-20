# Authoring Floor Fifty content

Everything a player sees a name for -- a character, a stage, the numbers a
race runs on, the order the screens go in -- is authored as TOML under
`content/`, compiled into one generated JSON artifact, and served to the
client by the server. This is the guide to writing that TOML.

Two rules sit above every other rule here:

- **TOML is the only thing you hand-edit.** `content/generated/content.json`
  is produced by `pnpm content:build` and committed. Editing it by hand will
  be caught by `pnpm content:check --verify-artifact` and reverted by the next
  build.
- **Content selects; it never defines.** Screens, events, actions, tunable
  names and their safe ranges are declared in TypeScript. A TOML file chooses
  among them. If the thing you want to write is not already offered, the
  change starts in code, with tests, and the TOML follows.

## The loop

```bash
pnpm content:check                    # validate, write nothing
pnpm content:build                    # validate and rewrite the artifact
pnpm content:watch                    # rebuild on save, keep the last good bytes
pnpm content:docs                     # regenerate the tunable table below
pnpm content:check --verify-artifact  # what CI runs
```

`pnpm dev` builds the artifact first and then runs the development server,
which watches `content/` for you. An invalid save prints diagnostics and keeps
serving the last artifact that compiled.

Every diagnostic has the same four parts:

```text
content/tuning.toml: GRAVITY: outOfRange: expected -1200..-100, received -2000
```

the file to open, the key inside it, a stable code, and what to write instead.
One save reports every independent problem, not the first one found.

## The source tree

```text
content/
  tuning.toml        every tunable, once
  flow.toml          which screen follows which
  events.toml        which action a presentation event reaches
  catalog.toml       which items are public, in which packs, and in what order
  unlocks.toml       the conditions an item can be earned by
  blocked-names.toml words a typed name may not contain in a public room
  juice.toml         racer juice: squash, dust, the slam's kick and hit-stop
  tutorial.toml      the interactive tutorial: its course, steps and stage
  characters/*.toml
  stages/*.toml
  songs/*.toml
  modes/*.toml
  examples/*.toml.example   reference templates, outside the compiler's glob
  generated/content.json    produced, committed, never hand-edited
```

Files under `examples/` end in `.toml.example` so they can describe assets and
rules that do not exist yet without failing a build.

## IDs, the catalog, and drafts

Every item has one stable ID matching `^[a-z0-9-]+$`, unique across *every*
kind -- no stage may share an ID with a character.

`catalog.toml` is the public set, in packs. Membership makes an item public;
position decides the order it is offered in, and the order of the packs is the
order of a grid's pages:

```toml
modes = ["floors-20", "floors-50", "infinite"]

[[packs]]
id = "base"
title = "Base"
stages = ["rooftops"]
songs = ["chrome-in-the-rain"]
characters = ["ninja", "frog", "diver"]

[[packs]]
id = "friends"
title = "Friends"
characters = ["robo", "kitsune"]

[[packs]]
id = "after-hours"
title = "After Hours"
dlc = true
characters = ["penguin", "oni", "witch", "knight"]
```

An item belongs to exactly one pack. A DLC pack is an access gate, not a
download: its items still ship in the build, so a player who does not own it
can still race a DLC stage the roulette chose, and only picking is refused.

An item file the catalog does not name is a **draft**. It is still parsed and
still validated, so it cannot rot, but it reaches neither the generated
artifact nor either revision. That is how you keep work in progress in the
repository without shipping it.

The one uncatalogued stage that ships is the one `tutorial.toml` names, with
its song (see *The tutorial* below). It rides inside the tutorial, never in the
public set, so no room can race it.

The catalog must name things that exist, of the right kind, once each.

### Unlocks

`unlocks.toml` lists the conditions a character, stage or song can be earned
by, in the order phase 4b grants them. An item names one with
`unlock = "games-5"`. The rule behind the ID is code, not content; the file
holds only the words a locked tile shows and the `goal` it counts progress
against. Every condition must be one a single player can meet on one device
(a match against CPUs counts), so everything outside a DLC pack can be earned
by playing alone:

```toml
[[unlocks]]
id = "games-5"
hint = "Finish 5 games"
goal = 5

[[unlocks]]
id = "games-10"
hint = "Finish 10 games"
goal = 10
```

### Blocked names

`blocked-names.toml` lists the words a typed name may not contain in a public
room (Find a race, and any room opened that way). It is a single `words` list of
letters and digits, three or more characters each:

```toml
words = ["blorp"]
```

A name is checked after lowercasing, folding look-alike characters (`0` to `o`,
`1` to `i`, `3` to `e`, `4` to `a`, `5` to `s`, `7` to `t`, `@` to `a`, `$` to
`s`) and removing everything that is not a letter, so spacing and punctuation
cannot split a word. A name that contains a word anywhere in it is replaced by a
`Racer NN` name for that room, with no error shown; the name the player's
device remembers is left alone. A private room never checks.

Because the match is anywhere in a name, a word that appears inside an ordinary
name, surname or place blocks those players for no reason they can see. Keep
every word clear of them: `tests/content/blocked-names.test.ts` lists the
ordinary names the shipped list must leave alone, and fails if a word catches
one. Words in other languages can be added to the same file at any time. The
file moves `contentRevision` only, never `rulesetRevision`.

### Juice

`juice.toml` tunes the racer juice (polish spec §4): the squash of a bounce and
a slam, the dust they throw, the slam's camera kick and hit-stop, the Floors
pop, the wrap streak, and the bursts at a spawn and at the finish. It is
presentation only. Every key moves `contentRevision` and never
`rulesetRevision`, and nothing in a race reads it.

- A squash is a list of steps, each a scale held for `ms` milliseconds: the
  racer steps through them and rests, anchored at its feet.
- A dust entry is `count` particles thrown `spread` logical units wide and
  `rise` high, living `lifeMs`. `ring = true` throws them evenly round.
- `slam.threshold` is the share of `FAST_FALL_VELOCITY` a fall must have
  reached for its landing to be a slam rather than a bounce.
- `slam.hitStopMs` is capped at 120: a longer freeze would hold the picture of
  an input.
- A stage whose floor face swallows the default dust names another palette
  role:

  ```toml
  [palette.stages.snow-shrine]
  dust = "cityNear"
  ```

To tune it by feel, run `pnpm dev` and open the game with `?dev=juice`. The
client asks for fresh content once a second, so a save is felt in the running
race within about a second. Production builds ignore the flag.

## Item schemas

Every table is strict: an unrecognised key is a rejection, never a silent
strip. Display names are 1 to 48 characters.

**Character** -- entirely cosmetic. A character is a body, and a character's
colour always comes from the seat that wears it, so it names one sheet and one
portrait per seat colour. The win and lose portraits are the neutral alias with
`Win` and `Lose` appended.

```toml
id = "ninja"
displayName = "Ninja"

[sheetAliases]
scarlet = "ninja.scarlet"
cyan = "ninja.cyan"
gold = "ninja.gold"
violet = "ninja.violet"

[portraitAliases]
scarlet = "portrait.scarlet"
cyan = "portrait.cyan"
gold = "portrait.gold"
violet = "portrait.violet"
```

Add `unlock = "games-5"` to earn it by play; leave it out for an open
character, or for one filed in a DLC pack.

**Stage** -- `courseTuning` is gameplay, `theme` is not. They are separate
tables so the distinction is visible while you edit.

A stage's `[course]` names its frozen seed and four `[[course.phrases]]`
(teach, combine, recover, finish) that tile its own climb, floors 1 to its
top. A mode that climbs higher (the 50-floor mode) needs the floors above
described too, in `[[course.extension]]` entries: `fromFloor`, `toFloor` and
`purpose`, with no name, so the city's arc stays the four phrases'. The
extensions tile the floors from the stage's top + 1 to the tallest finite
mode's top exactly once; a gap, an overlap or a floor past it is an
`invalidCourse`. An endless mode does not count. Like phrases, extensions
reach `contentRevision` only.

The frozen seed is the stage's **Classic** climb. A room races a random seed
unless a player picks Classic or enters one in stage select (stage seeds
spec), so the phrases describe the Classic climb's arc; on any other seed they
still band the floors, but nobody reviewed that layout.
`tests/shared/level/stage-courses.test.ts` climbs a batch of random seeds on
every stage and finite mode, so a tuning change that strands a random climb
fails there.

```toml
id = "rooftops"
displayName = "Rooftops"
platformAlias = "world.platform"

[courseTuning]          # partial; omit what the stage does not change

[theme]
backdropAlias = "menu.backdrop"
lightAlias = "world.sun"     # optional: the sun or the moon
ambienceAlias = "ambience.rooftop"    # optional: the bed under the race

# The scenery, back to front. Required: the list is the only description of
# what stands behind the climb. An alias that names no asset fails
# compilation like any other.
[[theme.layers]]
alias = "world.cityFar"
plate = "city"
depth = 0.15
sink = 240
haze = 0.25
extend = "skirt"

[[theme.layers]]
alias = "world.cityNear"
plate = "city"
depth = 0.35
sink = 290
haze = 0
extend = "skirt"

# Optional, and cosmetic. Absent means the legacy profile (no refraction, lift
# or ascent arc); the scenery is the layer list either way.
[theme.presentation]
profile = "aquarian"
refractionIntensity = 0.65   # 0 .. 0.8
horizonLift = 24             # 0 .. 48 logical units
lightHeight = 60             # optional: -200 .. 600; absent, -60
lightShimmer = false         # optional: absent, true; a moon sets false
silhouette = true            # optional: racers and floors drawn black

# Optional: the ascent arc, how far the city has sunk by the end of each
# course phrase. Needs a [course] with its phrases.
[theme.presentation.citySink]
teach = 0
combine = 40
recover = 120
finish = 560
```

Each `[[theme.layers]]` entry is one picture. Its height is its art's.

| Field | Range | Default | Meaning |
| --- | --- | --- | --- |
| `alias` | an asset alias | required | The art. The same alias may not appear twice. |
| `plate` | `"sky"` or `"city"` | required | The sky stays put; the city sinks with the ascent arc. |
| `depth` | 0 .. 1 | required | Parallax factor: 0 holds still, 1 moves with the floors. |
| `sink` | -720 .. 1440 | required | Where its roofline (or a band's foot) starts, in logical units: larger sits lower; a sky band above the origin is negative. |
| `haze` | 0 .. 1 | 0 | The share of texels stippled one swatch toward the sky. |
| `extend` | `"none"`, `"skirt"`, `"tile"`, `"plate"` | required | How the art fills what the camera sees beyond it: nothing, its last row stretched down, repeated down, or a full-frame sky picture (sky only). |
| `arc` | 0 .. 2 | `depth / 0.35` | City only: the layer's share of the ascent arc. |
| `drift` | 0 .. 3 | 0 | Sideways speed in logical units per second. A `"plate"` cannot drift. |

Two ordering rules:

- **Back to front within each plate.** A layer may not be further (smaller
  `depth`) than the layer of the same plate before it; the sky and the city
  are ordered separately. A sky plate (`extend = "plate"`) must be the first
  sky layer, because it is drawn behind the light and everything else.
- **Ties keep list order.** Two layers at the same depth draw in the order
  listed, the later in front, so windows listed after their skyline stand on
  it.

The `[theme.presentation]` table, when present:

| Field | Range | Default | Meaning |
| --- | --- | --- | --- |
| `profile` | `"aquarian"` | required | The presentation profile; the only one. |
| `refractionIntensity` | 0 .. 0.8 | required | How strongly the scenery refracts, as if seen through air. |
| `horizonLift` | 0 .. 48 | required | How far the skyline is lifted, in logical units. |
| `lightHeight` | -200 .. 600 | -60 | How far above the world origin the light (`lightAlias`) stands at the start of the climb, in logical units. -60 is low behind the rooftops; a night stage hangs its moon high. |
| `lightShimmer` | `true` or `false` | `true` | Whether the light shimmers with heat. A moon is cold: set `false`. |
| `silhouette` | `true` or `false` | `false` | Draws the racers and floors as black shapes. |
| `citySink` | a table of `teach`, `combine`, `recover`, `finish`, each 0 .. 720 | absent: the city holds | The ascent arc: how far the near skyline has sunk below the climb by the end of each course phrase, in logical units. Further city layers sink in proportion to their `arc`. The city moves linearly between phrase ends, and a value smaller than the one before it is held at the one before. It needs the stage's `[course]` phrases; without them the city holds. |

Nothing in `theme` reaches `rulesetRevision`, including the presentation table.
It selects how the scenery looks and nothing about how a race is decided, so a
room frozen on one ruleset plays identically whichever of these it was authored
with. The bounds above are enforced by both the source schema and the artifact
decoder -- an out-of-range value is refused where it is written, and again when
the artifact is read.

**The tutorial** -- `tutorial.toml` is a base-tuning course from `seed`, with
its steps in order (`targetFloor` is read by nothing now; the last step ends the
tutorial), and the stage and song it is played
with:

```toml
seed = 4
targetFloor = 8
stageId = "dawn"           # any stage file, catalogued or not
songId = "dawn-tutorial"   # any song file no pack lists
```

The named stage and song are emitted inside the artifact's `tutorial`, not in
`stages` or `songs`. A `stageId` or `songId` that names nothing, or a `songId`
a pack lists, is refused naming `content/tutorial.toml`. The tutorial reaches
`contentRevision` only.

**Song** -- `loopEndMs` must exceed `loopStartMs`, `bpm` must be positive, and
offsets may not be negative. A song in a pack needs a `coverAlias`, whose alias
and alias plus `Large` the manifest must carry; an optional `unlock` names a
condition in `unlocks.toml`. See `content/examples/song.toml.example`.

- **Every song in a pack needs a preview clip** (`<audioAlias>Preview`, in
  `shell`). The song step plays it while the song's slide is on screen; a
  locked song plays none.
- **The intake:** `pnpm intake:song <master.wav> <id> --title "<Title>"
  [--unlock <condition>]` measures a master and writes its TOML and row.
  `--preview` cuts the preview from the results window, which is chosen by
  ear. A hand-edited TOML needs `--force`.

**Mode** -- a race option the host picks in the ready room: an ID, a display
name, a `course`, a `laps` list, and a partial `tuning` table. See
`content/examples/mode.toml.example`; the catalog's order is the order the
ready room offers them, and a new room starts on the first.

- `course` is `"finite"` (the race ends at the top floor) or `"endless"` (the
  course grows without end and the race ends on its clock).
- `laps` lists the lap counts offered, each 1 or 3, at least one, none twice.
  The Laps row shows only when a mode offers more than one.
- An endless mode must resolve to a positive `RACE_TIME_LIMIT_TICKS`, and a
  finite one to 0. Either mistake is an `invalidMode` diagnostic.
- `course` and `laps` reach `rulesetRevision`, as the mode's tuning does.

## Tuning, and the order it resolves in

`content/tuning.toml` must name every tunable exactly once. Stage and mode
files are partial overrides, applied in this order:

```text
tuning.toml base  <-  selected stage courseTuning  <-  selected mode tuning
```

Later layers replace earlier values by name. Every layer is checked
independently against the same declarations, so an out-of-range value is
refused where it is written rather than after it has been merged.

Three ways a tunable can be refused:

- `unknownField` -- no such tunable. Usually a typo.
- `invariantNotAuthorable` -- a real constant, but a code-only one. Tick rate,
  snapshot rate, viewport size, room capacity, and protocol version decide
  determinism, framing and capacity; changing one is a code change with tests,
  not an authored value.
- `outOfRange` / `invalidType` -- outside the inclusive range below, or
  fractional where the declaration says `int`.

<!-- BEGIN GENERATED TUNABLES -->

| Name | Type | Inclusive range | Value in `content/tuning.toml` |
| --- | --- | --- | --- |
| `BOUNCE_VELOCITY` | float | 100 to 1200 | 268.2 |
| `COURSE_FLOOR_COUNT` | int | 20 to 100 | 20 |
| `DEATH_LINE_MARGIN` | int | 100 to 800 | 265 |
| `DEMAND_RAMP_BAND_FLOORS` | int | 1 to 100 | 10 |
| `DEMAND_RAMP_FROM_FLOOR` | int | 50 to 1000 | 50 |
| `FAST_FALL_VELOCITY` | float | -2000 to -100 | -1341 |
| `FLOOR_GAP_MAX` | float | 40 to 320 | 128.57142857142856 |
| `FLOOR_GAP_MIN` | float | 40 to 200 | 128.57142857142856 |
| `FLOOR_HEIGHT` | int | 8 to 64 | 20 |
| `FLOOR_WIDTH` | int | 64 to 256 | 120 |
| `GRAVITY` | float | -1200 to -100 | -275 |
| `LAP_HOLD_TICKS` | int | 0 to 120 | 48 |
| `MAX_MOVE_SPEED` | float | 50 to 900 | 356 |
| `MOVING_FLOOR_CARRY` | float | 0 to 1 | 1 |
| `MOVING_FLOOR_SPEED_CAP` | float | 0 to 400 | 300 |
| `MOVING_FLOOR_SPEED_MAX` | float | 0 to 400 | 200 |
| `MOVING_FLOOR_SPEED_MIN` | float | 0 to 400 | 100 |
| `MOVING_SHARE_MAX` | float | 0.5 to 1 | 0.8 |
| `MOVING_SHARE_STEP` | float | 0 to 0.5 | 0.05 |
| `MOVING_SPEED_STEP` | float | 0 to 100 | 10 |
| `PLAYER_HEIGHT` | int | 16 to 128 | 59 |
| `PLAYER_WIDTH` | int | 16 to 96 | 59 |
| `RACE_TIME_LIMIT_TICKS` | int | 0 to 36000 | 0 |
| `SURVIVAL_BAND_AHEAD_MAX` | float | 1 to 3 | 1.5 |
| `SURVIVAL_BAND_AHEAD_STEP` | float | 0 to 1 | 0.1 |
| `SURVIVAL_BAND_BEHIND_MIN` | float | 0.1 to 1 | 0.7 |
| `SURVIVAL_BAND_BEHIND_STEP` | float | 0 to 1 | 0.05 |
| `SURVIVAL_GRACE_TICKS` | int | 0 to 1800 | 180 |
| `SURVIVAL_PUSH_AT` | float | 0.3 to 0.9 | 0.55 |
| `SURVIVAL_PUSH_SPEED` | float | 50 to 1200 | 300 |
| `SURVIVAL_RISE_CAP` | float | 0 to 400 | 150 |
| `SURVIVAL_RISE_START` | float | 0 to 400 | 55 |
| `SURVIVAL_RISE_STEP` | float | 0 to 200 | 20 |
| `SURVIVAL_RISE_STEP_TICKS` | int | 60 to 3600 | 1800 |
| `SURVIVAL_START_WAIT_TICKS` | int | 0 to 3600 | 600 |
| `SURVIVAL_VIEW_HEIGHT` | float | 300 to 1200 | 480 |
| `TUTORIAL_EDGE_RISE` | float | 5 to 200 | 30 |
| `TUTORIAL_EDGE_START_BELOW` | float | 60 to 600 | 240 |

<!-- END GENERATED TUNABLES -->

Regenerate that table with `pnpm content:docs`. CI fails if it has drifted
from `packages/shared/src/common/tuning.ts`.

## Art aliases

An alias must appear in `packages/asset-contract/assets/art-manifest.json`.
The content pipeline checks only that the name exists; the file behind it, its
dimensions, its palette roles and its provenance all belong to the asset
contract. Adding an asset is that contract's workflow, and the alias becomes
authorable the moment the manifest carries it.

## Screen flow

`flow.toml` decides which screen follows which. It cannot create a screen,
call a function, read state, or change anything the server owns.

```toml
entry = "Splash"

[[transitions]]
from = "Gameplay"
event = "raceFinished"
to = "GameEnd"
transition = "liquid"
```

`transition` says how the screens change: `"cut"`, the default when it is
absent, or `"liquid"`, the wipe under the veil that the race's edges use
(race-flow spec §7). The styles are code-owned, as screens and events are
(`TRANSITION_STYLES` in `packages/shared/src/content/presentation.ts`), and
the compiler refuses any other.

`FLOW_TARGETS` in `packages/shared/src/content/presentation.ts` is the
capability boundary: for each `(from, event)` pair it lists the destinations
that screen's implementation is actually prepared to enter. The compiler
requires:

- the entry to be `Splash`, with no transition back into it;
- exactly one transition for every declared pair, and no undeclared pair;
- a destination from that pair's list, and no self-transition;
- every screen reachable from the entry, and every reachable screen able to
  leave again.

Cycles are fine -- racing again returns through the menu on purpose.

## Presentation events

`events.toml` connects a code-owned presentation event to a code-owned action.

```toml
[[routes]]
source = "room.finished"
order = 10
action = "flow.race-finished"
```

`PRESENTATION_ROUTE_CAPABILITIES` lists which actions each source may reach;
`PRESENTATION_ROUTE_REQUIREMENTS` lists the pairings an artifact must wire.
Orders are unique per source and run ascending, so **the order routes appear
in the file means nothing** -- move a route and nothing changes; change its
`order` and the sequence does.

What routing cannot do is as important as what it can:

- it cannot declare an event, a payload, or an action;
- it cannot read, filter, compare, or transform a payload;
- it cannot reach simulation state, standings, timing, room phase, a network
  command, persistence, or telemetry;
- an action receives no way to publish, so no route can form a cycle.

Diagnostics record the source, the action, its order and the content revision,
and never the payload, so a player's name or a room code cannot reach a log
through this path.

Event and action names are public content contract. Adding one is backward
compatible; removing or renaming one, or changing a payload incompatibly,
requires an artifact schema-version migration.

## When a reload takes effect

`pnpm content:watch` and the development server rebuild on save, and publish
only after a build succeeds. What happens next depends on where the game is:

- **A race already running keeps its content.** A room reads the store once,
  at creation, and never again. Tuning, flow and routing are frozen for its
  whole life.
- **Menus refresh.** The client refetches `/content` when the server announces
  a new revision and whenever a snapshot names content it has not fetched.
- **Flow and routing swap together, on the menu.** Never on splash, gameplay,
  or the results screen, and never half of a pair.
- **An invalid save changes nothing.** Diagnostics print, the previous bytes
  stay on disk, the previous configuration stays live, and the watcher stays
  up for the fix.

## The revisions

The artifact carries SHA-256 digests over canonical bytes:

- `contentRevision` covers the whole payload. Anything you author moves it.
- `rulesetRevision` covers base tuning and modes. Each stage has its own
  `courseRevision`, over its seed and course tuning with base tuning. The
  artifact carries them in `courseRevisions`, keyed by stage ID.

So reordering the character menu, repointing a backdrop, retiming a song, or
rewiring a presentation route moves `contentRevision` alone. A stage's seed or
course override moves `contentRevision` and that stage's `courseRevision`, and
leaves `rulesetRevision` alone, so shipping a stage invalidates no replay of
another. Changing base physics moves every revision; a mode's overrides move
`contentRevision` and `rulesetRevision`.

A race on a random or entered seed (stage seeds spec) records its own seed in
the replay, but the replay is still checked against the stage's
`courseRevision`. So changing a stage's authored seed refuses the replays of
every race on that stage, random ones included.

No digest is part of another's input, and none covers the envelope that
carries them -- which is what lets `--verify-artifact` recompute them all and
then compare the whole file byte for byte.

## Words players read, in every language

The TOML is the English source for every name and sentence a player reads:
a stage's or character's `displayName`, a pack's `title`, an unlock's
`hint`, and each tutorial step's prompts. Keep writing them in English here.

`pnpm content:build` also writes `apps/client/messages/content/en.json`
from them, keyed `content_stage_<id>_name`, `content_character_<id>_name`,
`content_pack_<id>_title`, `content_unlock_<id>_hint` and
`content_tutorial_<kind>_<method>` (IDs and kinds in snake_case). Translators
work from that file (languages spec §4.2), and `--verify-artifact` refuses a
stale one, so commit it with the TOML change. It is derived beside the
artifact, never inside it: neither revision sees it.

A new item, or a changed English line, needs its translations: until a
locale has the key the game shows the English, and the release check counts
the string as unreviewed. A song's `displayName` is its title and is never
translated, so songs have no key.
