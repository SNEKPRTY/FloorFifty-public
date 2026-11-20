# Resurrect Arcade: Accepted Art Brief

This is the accepted authority for every runtime texture in Floor Fifty. It is
what the manifest schema and `pnpm assets:check` enforce; an asset that does not
match a row here does not ship.

It supersedes `docs/art/twilight-steel-ninja-brief.md`, which is retained as the
record of the previous direction and is not a runtime authority.

No legacy texture from `References/FloorFiftyVerticalSlice/assets` is a runtime
dependency. Those files are evidence of the original build only.

## Art Direction

Pixel-art racers climbing a city skyline at dawn, in the Resurrect 64 palette.

This direction was reframed once, against a design reference, after the first
pass shipped characters nobody could accept. The reframing is recorded honestly
in **What Changed, And Why** below rather than written out of history, because
the first pass failed for reasons worth not repeating.

The field is **high-key**. The sky is the brightest thing on screen and the
picture is built in light, not in shadow.

- The sky is a pale dithered field, cool blue overhead warming to peach at the
  horizon, and never banded. Every other element reads against it.
- **Clouds are white puffs with a warm underside and no outline.** They are the
  only thing lighter than the sky, and the only foreground element that carries
  no border — an outlined cloud reads as a solid object rather than as air.
- The city is two layers separated by value **and** saturation: a far layer
  hazed toward the sky, a near layer darker and saturated, carrying warm lit
  windows. It is not a silhouette. Silhouette-against-dark is the failure this
  direction corrects.
- **Each layer runs well below its own roofline.** The rooftops vary within a
  band; below that band the buildings continue as solid body to the bottom of
  the strip. The city is a skyline seen from inside it, not a row of blocks
  standing on nothing — a climber near the ground must never see sky underneath
  the buildings. A dusk field hid that gap; a high-key one does not.
- Platforms are chunky slabs with a dark outline, a mid-value body, and a bright
  top face. The top face is the readability budget, because it is what a player
  judges a landing against.
- **Every foreground mass carries a two-pixel dark border.** This is the rule the
  whole direction leans on. The background is bright, so figure and ground no
  longer separate by value; the border does it. At one pixel it disappears at
  the scale the game is played at.
- Characters are **super-deformed**: a big round head over a small body, in the
  proportions of the reference rather than of a person. Silhouette first,
  anatomy never.
- A character's outfit is **two tones of one hue** — a body value and a shadow —
  and nothing else. Not one flat tone, which is what the first pass specified
  and which left the figure reading as a blank; and not full shading, which
  spends contrast on detail nobody resolves at sprite scale.
- All four seats share one pose set, recoloured. Every racer has an identical
  silhouette, and colour is the only difference between them. Belt, straps and
  equipment stay neutral across all four, so identity lives in the outfit alone.
- UI is chip-framed in the same language as the world: the same two-pixel
  border, a bevel, bitmap type, and portrait badges. A HUD chip and a platform
  have to look like they came from one hand.

## What Changed, And Why

The first pass at this brief specified a dusk field and **flat, single-tone,
Game & Watch characters with no interior shading**. It was generated and
rejected. What it actually produced, and what that taught:

| The rule | What it produced | What replaced it |
| --- | --- | --- |
| Flat single-tone body, no interior shading | An unqualified "ninja" prompt returns a figure in the palette's darkest swatch. Measured on the first sheet: 8,354 pixels of `outline` against 4,223 of the next colour. Recolouring that gives a black racer wearing a coloured patch — the exact defect the rule existed to prevent. | Two tones of one hue, and the outfit colour named in the prompt so it arrives as one large region. |
| Dusk sky, city in silhouette | The picture had no light in it, and a dark field forced every foreground element to be light to be seen. | A high-key field. Separation moved into a two-pixel border, which works against any background. |
| Poses generated one still at a time at 64 x 96 | Thirteen generations for one character, each independently framed, and the frame size fought the generator rather than the other way round. | One `create-1-direction-object` call at 32 x 32 returns 64 candidate sprites, and the best is chosen on measurement. One generation, not thirteen. |
| 8-rotation character endpoint | This is a 2D sidescroller. Seven of the eight rotations are waste, and the two true profiles came back cropped. | `create-1-direction-object` with `view: "sidescroller"`, which has no rotations at all. |

Three palette roles and one seat colour moved with the reframing — `skyHigh`,
`skyLow`, `cityWindow`, and the gold seat. Each records its reason in
`packages/asset-contract/src/roles.ts`. The gold seat moved because a bright sky
put the old amber 32 of luma from the field behind it, under the 40 the contract
requires; the seat moved rather than the sky, because keeping the direction
high-key was the point.

## Palette Roles

The palette has one authored form, `packages/asset-contract/palettes/resurrect64.hex`,
and three derived ones. The role table below is **generated** from
`packages/asset-contract/src/roles.ts` and must not be hand-edited; run
`pnpm assets:palette` after changing a binding and copy the emitted values here.

Palette: Resurrect 64 by Kerrie Lake, <https://lospec.com/palette-list/resurrect-64>.

| Role | Swatch | Value | Used for |
| --- | --- | --- | --- |
| `skyHigh` | 48 | `#8fd3ff` | Sky overhead; cool |
| `skyMid` | 53 | `#eaaded` | The dawn band between the two; the transition that makes the field read as dawn rather than as a bright afternoon |
| `skyLow` | 63 | `#fdcbb0` | Sky at the horizon; warm, and the lighter of the two |
| `cloud` | 9 | `#ffffff` | Cloud puffs; the lightest thing on screen |
| `cityFar` | 7 | `#9babb2` | Distant skyline; low saturation, hazed toward the sky |
| `cityMid` | 6 | `#7f708a` | Middle skyline; between the other two by value |
| `rooftopDetails` | 0 | `#2e222f` | Nearest scenery props; the darkest thing in the scenery |
| `cityNear` | 1 | `#3e3546` | Near skyline; dark, cool, and quiet behind everything in front of it |
| `cityNearEdge` | 0 | `#2e222f` | The near skyline's own shaded return |
| `cityWindow` | 17 | `#f79617` | Lit windows, and the key the city bloom reads |
| `platformBody` | 36 | `#547e64` | Platform body |
| `platformTop` | 38 | `#b2ba90` | Platform top face; the landing surface |
| `platformGlow` | 37 | `#92a984` | The lip under a platform's top face |
| `platformMovingTop` | 27 | `#d5e04b` | The top face of a moving platform |
| `floorTaken` | 31 | `#1ebc73` | A floor the local player has already landed on |
| `floorPending` | 12 | `#ea4f36` | A floor the local player still owes a landing |
| `platformOutline` | 0 | `#2e222f` | Platform outline and underside |
| `outline` | 0 | `#2e222f` | Universal foreground border; the palette's darkest swatch |
| `uiChipFill` | 1 | `#3e3546` | Chip panel fill |
| `uiChipEdge` | 2 | `#625565` | Chip panel bevel |
| `uiText` | 9 | `#ffffff` | Primary UI and HUD text |
| `uiMuted` | 6 | `#7f708a` | Secondary UI rows |

| Player colour | Swatch | Value |
| --- | --- | --- |
| `scarlet` | 15 | `#e83b3b` |
| `cyan` | 47 | `#4d9be6` |
| `gold` | 16 | `#fb6b1d` |
| `violet` | 51 | `#905ea9` |

Each binding is justified in a doc comment beside it in `roles.ts`, and the
relationships the direction depends on are asserted in `tests/shared/palette.test.ts`:
the sky is lighter than every other region, the dawn band falls between the other
two sky tones and above every region it sits in front of, the clouds are lighter
than the sky, a platform's top face separates from its body by more than thirty
of luma, the two city layers separate by more than twelve, and every player
colour clears both sky swatches by more than forty.

## Required Output

Every alias below is produced by one of two commands, recorded per asset in its
manifest `provenance.tool`.

### World

| Alias | Role | Size | Producer |
| --- | --- | --- | --- |
| `world.sun` | `image` | 256 x 256 | `pnpm assets:placeholder` |
| `world.clouds` | `image` | 960 x 140 | `pnpm assets:placeholder` |
| `world.cityFar` | `image` | 960 x 360 | `pnpm assets:city` |
| `world.cityMid` | `image` | 960 x 400 | `pnpm assets:city` |
| `world.cityNear` | `image` | 960 x 440 | `pnpm assets:city` |
| `world.rooftopDetails` | `image` | 960 x 220 | `pnpm assets:city` |
| `world.lanterns` | `image` | 960 x 440 | `pnpm assets:city` |
| `world.platform` | `sheet` | 128 x 32 per frame, 2 rows | `pnpm assets:city` |

Four skylines rather than three, back to front: `cityFar`, `cityMid`, `cityNear`
and the rooftop details. Each separates from its neighbours by value as well as
by parallax factor, which is what the depth is read from.

There is no sky plate. The sky is a Bayer-dithered shader pass across `skyHigh`,
`skyMid` and `skyLow`, because a 64-colour palette has too few steps along a ramp
to carry a 540-pixel gradient without banding, and because a shader can raise the
horizon as a player climbs. Three tones rather than two: a two-step field between
overhead and horizon reads as one flat pale blue, and the middle band is what
makes it read as dawn. The clouds are a real asset rather than part of that
pass, because they need a parallax factor of their own.

### Characters

Four sheets, one per player colour, generated once as a single pose set and
recoloured at build time so every seat shares an identical silhouette.

| Animation | Frames |
| --- | --- |
| `idle` | 2 |
| `run` | 4 |
| `jump` | 1 |
| `fall` | 1 |
| `land` | 2 |

Rows are laid out in that order, top to bottom, each row left-aligned at frame
zero, with unused cells in a short row fully transparent.

Frame size and the measured ink height are recorded under **Measurements**
below; they are measured from the generated sheets rather than assumed.

A racer is drawn at the size the Bevy reference draws one — `player.rs:10`'s
`PLAYER_SIZE`, which is `32 * 1.56` logical units, square. That is a parity
fact rather than an art choice, so the art is authored to fill its frame and
the frame is what scales to it. It is deliberately smaller than the collider
the racer sits on: the reference's collider is `Collider::ball(PLAYER_SIZE /
1.7)`, and that diameter is what the shared tuning carries as `PLAYER_WIDTH`
and `PLAYER_HEIGHT`.

Aliases: `ninja.scarlet`, `ninja.cyan`, `ninja.gold`, `ninja.violet`, plus one
`portrait.*` bust per player colour at **32 x 32**, cropped from the top 55% of
the ink in that seat's standing pose. A portrait is drawn beside each HUD roster
row, so a player finds their own row by face before reading any name. The ready
room identifies a seat by its scarf colour on the row's left edge instead, which
is the same information at a size where a 32 x 32 face would not read.

### UI

| Alias | Role | Size | Notes |
| --- | --- | --- | --- |
| `menu.backdrop` | `image` | 960 x 540 | The one opaque plate; drawn at the logical viewport by the refraction shader |

`ui.chipFrame` and `menu.titlePlate` were both retired by the Aquarian pass:
the chip frame's nine-slice panel became a CSS surface, and the title plate's
pixel panel became live typography. Neither had a caller left, and the asset
contract's rule that nothing declares an asset the renderer never addresses
caught them. Their `git log` entries are the history.

`menu.backdrop` is a full 960 x 540 scene rather than the 320 x 180 plate it was
when the menu was drawn at a 3x logical upscale. A dither at that size is one
pixel of the plate drawn as three on screen, and read as a chequerboard; at the
logical size it reads as the woven gradient it means to be.

The `menu` bundle is no longer empty. The previous direction declared it
intentionally so because the menu was built from HTML and the renderer's own
text; the menu now carries authored art and a Svelte shell that draws it.

### Typeface

One face serves both layers, which is the requirement. **How** it does so
changed during execution, and both halves of the story are recorded here because
the manifest still carries the road not taken.

**Shipping: Silkscreen**, a 5 x 7 bitmap face under the SIL Open Font License
1.1, vendored as woff2 under `apps/client/public/fonts/`. The Svelte chrome and
the Pixi HUD both set type in it — the HUD through `Text` with
`fontFamily: "Silkscreen"` — so the canvas and the page are one typeface.
**Press Start 2P** (also SIL OFL 1.1) sets display type only; it is an 8 x 8
arcade face with no lowercase rhythm, unreadable as a paragraph and right as a
sign. Licences and the reasoning are in `apps/client/public/fonts/README.md`.

They are self-hosted rather than linked from a CDN: a game that fetches its face
over the network shows fallback text on a slow connection, and fallback text in
a pixel menu is the one element that does not look drawn.

**Retired: Arcade Chip 5x7 and the `ui.font` glyph page.** Arcade Chip was drawn
as code in `packages/asset-contract/tools/font-data.ts` and rasterised into a
16 x 6 grid of 6 x 8 cells, for a Pixi `BitmapText` path the HUD did not take:
nothing in the client installs a `BitmapFont`, and building one would have been
new infrastructure for the outcome the webfont already delivers. It shipped as a
generated, validated asset that nothing drew.

It is now deleted — the glyph data, the generator's `drawGlyphPage`, the PNG and
the manifest row. The manifest declares **17** assets rather than 18. Retiring it
was chosen over building the `BitmapFont` install because the requirement it
existed to meet — one typeface across the canvas and the page — is already met,
and an asset kept for a path nobody is walking is a thing the next reader has to
work out the status of. `git log` holds it if the `BitmapText` path is ever
wanted.

The three criteria below were what Arcade Chip was selected against. They are
kept because they remain the bar for any face this project sets type in, and the
shipping pair is judged against them at the end of this section:

1. **Licence.** Original work in this repository, under the same terms as the
   rest of the art set, so embedding and redistribution in a commercial product
   are unencumbered. No third-party font file is vendored or fetched.
2. **Whole-pixel rendering.** It is defined as bitmaps rather than outlines —
   seven rows of five bits per glyph — so it is whole-pixel by construction at
   the HUD's logical size, with no hinting to disable and nothing to round.
3. **Coverage.** Every code point from 32 to 127 renders: 94 of the 96 cells
   carry ink, the two blanks being space and DEL. Lowercase resolves to the
   uppercase glyph, so the face sets small caps rather than leaving a missing
   box in a player name.

**Criterion 1 was relaxed, deliberately.** It ends "no third-party font file is
vendored or fetched", and the shipping faces are third-party files vendored into
`apps/client/public/fonts/`. The requirement behind the clause is unencumbered
commercial use, embedding and redistribution, and the SIL Open Font License 1.1
grants all three. "Or fetched" still holds and is the part that matters at
runtime: nothing is loaded from a CDN. Criteria 2 and 3 hold unchanged — both
faces are bitmap designs on an integer grid, set at multiples of their
eight-pixel em, and both cover the latin subset the UI needs.

### Audio

Audio is not defined here. The manifest declares an `audio` bundle that is
deliberately empty; the Production Experience initiative fills it.

## Hard Constraints

Every one of these is machine-checked by `pnpm assets:check`:

1. Every alias in this brief exists exactly once in the manifest.
2. Declared frame dimensions match the file on disk, accounting for the sheet
   layout above.
3. Every sprite has a real alpha channel and a fully transparent background.
4. Every character sheet declares all five animations.
5. Every asset declares at least one palette role drawn from the tables above.
6. Every asset carries provenance: the tool, the prompt, a source reference, and
   a licence. An asset altered after generation records `quantizedTo`.
7. **Every opaque pixel of every shipped asset is one of the 64 swatches.** This
   is what makes the palette a contract rather than prose. It is enforced over
   the files on disk, which no shader touches.

## Prohibited

- A hex literal authored anywhere but `palettes/resurrect64.hex`. Every colour
  resolves through a role.
- Interior shading on a character.
- Copied or recognisable characters, logos, or trademarks.
- Baked typography inside a sprite.
- Non-transparent sprite backgrounds.
- Any texture carried over from the Bevy reference build.

## Regeneration

**`pnpm assets:palette`** regenerates the swatches, the CSS tokens, and the
shader lookup texture from the canonical hex file.

**`pnpm assets:placeholder`** draws the two assets a generator cannot be asked
for: the sun, which has to be a disc and nothing else, and the cloud band, which
has to tile without a seam.

**`pnpm assets:city`** converts the reviewed generated illustrations into every
scenery plate: the three skylines, the rooftop details, the lantern accents, the
platform sheet and the menu backdrop.

**`pnpm assets:generate`** procures the character pose set and the portraits from
PixelLab under a palette constraint, then recolours the poses per seat. It needs
`PIXELLAB_API_KEY` in `.env.local` and spends generation quota, so it is a manual
step rather than a build step.

**`pnpm assets:quantize`** maps an asset onto the nearest swatch. It is a repair
tool and an assertion, not a pipeline stage: everything here is generated
on-palette at source, so an asset that needs it is a bug report.

## Measurements

Filled in by the tasks that measure them, rather than assumed in advance.

- **Character frame:** 32 x 32, from `create-1-direction-object` at `size: 32`.
- **Measured ink height:** 31 of 32 pixels, on every pose of every seat.
- **Drawn size:** `32 * 1.56` logical units square, matching `player.rs:10`.
- **Typeface and licence:** Silkscreen for UI, Press Start 2P for display, both
  SIL Open Font License 1.1 and vendored as woff2. See **Typeface** above.

## Review

Automated checks establish that an asset is well-formed, never that it is good.
Human sign-off against this brief is recorded in
`docs/art/resurrect-arcade-review.md` and is a release gate.
