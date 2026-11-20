# Floor Fifty — reimagined art and UI brief

Date: 2026-09-19

> **Direction update — 2026-09-20:** The user selected the
> [Aquarian concept](explorations/2026-09-20-refinement/aquarian.png).
> The Aquarian beauty-pass spec
> now controls the proposed UI typography/materials, separate UI color tokens,
> gameplay scenery refraction and enhanced stage layers. Its
> implementation plan
> is prepared for review; runtime implementation and human acceptance remain
> outstanding. Older ink/amber/pixel-panel requirements below are historical
> where they conflict. Sprite identity, palette-bound world art, readable
> landing geometry and authoritative game behavior remain preservation targets.

Status: approved direction for the Exceptional Race Slice; production assets
remain unapproved until they pass the slice review.

## Intent

Make the four-player climb read immediately: find your racer, see the next landing surface, understand progress, and get into a room quickly. Preserve the city-at-dawn identity, automatic bounce, four equivalent player seats, and existing race rules.

The user requested ImageGen exploration and a concrete art/UI brief. This document assumes the reimagining should build from the current bright dawn direction. It explores presentation, not new game modes or mechanics.

## Visual exploration

- [A — Dawn Arcade](explorations/2026-09-19/dawn-arcade.png): expressive pixel characters, atmospheric city layers, chunky landing surfaces, dark compact HUD chips.
- [B — Skyline Signal](explorations/2026-09-19/skyline-signal.png): a more graphic alternative, using broad flat shapes and architectural signage.
- [Exact generation prompts](explorations/2026-09-19/prompts.md): built-in ImageGen, no API/CLI fallback.

Both images are mood and composition studies. Generated text, geometry, pixel density, colors and screen proportions are illustrative, not specifications. The written requirements below govern a future implementation.

### What to keep and reject from the generated boards

| Board | Keep | Reject or correct |
| --- | --- | --- |
| A | Atmospheric depth, expressive pixel silhouettes, clear amber primary action, local-player marker | Invented Space-to-jump controls and slogans; excessive facade/platform texture; edge buildings that resemble playable terrain; timer should use m:ss.t |
| B | Simple platform faces, restrained windows, bold number hierarchy, immediately distinct primary action | Oversized sun competing with action; decorative floor numbers implying world progress; smooth vector-like racers as direct production replacements; stray transparency/edge artifacts in board framing |

Neither board obeys the requested 16:9 gameplay inset exactly. Neither proves animation, mobile readability, exact palette membership, or existing camera framing. Preserve their visual relationships while rebuilding layouts to the measurements below. No cleanup is needed to use these as exploratory references; both would require authored production assets before shipping.

## Direction: Dawn Arcade with signage-led UI

Use A's character charm and depth, with a quieter city and stronger typographic hierarchy. Borrow the idea of floor signage from B for numbers and UI grouping. The intended impression is a lively rooftop arcade race in morning light. This is the selected direction, not another option awaiting comparison.

The current saved gameplay screenshot has dense isolated window pixels, foreground-weight outlines on distant architecture, a large translucent floor count, and a timer floating beside the racer. Together with the visible display grille, these compete for attention. The saved menu has weak differentiation between the primary and secondary actions. These observations concern the checked-in screenshots, not a fresh live capture.

| Decision | Direction |
| --- | --- |
| First thing seen in play | Local racer and nearest landing edges |
| Second thing seen | Floor progress, then lap and standings |
| Atmosphere | Open pale sky, warm horizon, distant city haze |
| Shape language | Round character heads; rectangular slabs; stepped UI corners |
| Detail budget | Character silhouette and platform tops; sparse scenery detail |
| Primary action | Amber filled button with dark text |
| Display effect | Clean art by default; LCD treatment becomes an optional presentation setting |

Choosing the clean default, relocating the timer, and replacing the oversized floor tally are proposed departures from the current presentation parity decisions. They require deliberate implementation changes; this exploration does not change them.

## Art rules

### World

Use three clearly separated visual depths: quiet sky/clouds, a pale distant skyline, and a muted near skyline. Reserve the strongest outlines for racers, platforms and UI. Remove dark outlines from far buildings; near buildings use local-value edges.

At the representative mid-climb camera position, target roughly half the visible field as quiet sky. This is a composition goal, not a camera or course-generation change. Building strips must continue below their rooflines to the bottom of the asset; no sky gaps under buildings.

Group windows into short runs with large unlit areas. Begin with lit pixels occupying no more than 5% of a building facade, then judge at actual play scale. Avoid random single-pixel glitter. No new decorative writing on buildings. Background rooftops must not look like usable platforms.

Keep the sky transition subtle. Dither only where it helps the limited palette; avoid a high-contrast checkerboard covering the entire sky. No bloom on characters, UI, or landing edges.

### Racers

Keep one shared pose set, recolored for four seats. A rounded head should occupy about half the ink height. Each outfit uses one main color plus one shadow tone; eyes and hands remain sparse neutral details. No weapons or unique seat equipment.

Preserve the current 32 × 32 source frames and 49.92-logical-unit drawn footprint for the first production trial. The prompts deliberately explored larger racers, but the resulting apparent scale is not an instruction to enlarge sprites, zoom the camera or change collision geometry.

Animation remains idle 2, run 4, jump 1, fall 1, land 2. Judge each pose in isolation, especially jump versus fall. Keep alpha silhouettes identical across seats and leave unused sheet cells transparent.

Pair color with a stable seat number in HUD/lobby UI. Mark the local racer with a small white triangle edged in dark plum; use a short YOU label only where it remains readable. These markers are interface overlays, not baked into sprite sheets.

### Platforms

Preserve the physical landing geometry and platform dimensions. Use a quiet mid-value body, a bright continuous top edge, and a dark underside. No moss, railings or bevels that suggest a different collision surface.

Retain the existing collected/pending semantics. Pair the colored indicator with a small check for collected and a hollow mark for pending. Keep both beneath the slab so they cannot be mistaken for the landing edge.

## Color and type

Keep Resurrect 64 as the production palette. Values below are existing role references, not permission to introduce hex literals in component code.

| Role | Reference | Use |
| --- | --- | --- |
| Sky / horizon | #8fd3ff / #fdcbb0 | Quiet background |
| Cloud | #ffffff | Sparse bright shapes |
| Ink / panel | #2e222f / #3e3546 | Foreground outline, opaque UI |
| Distant / near city | #9babb2 / #6b3e75 | Starting roles; near coverage must stay restrained |
| Platform body / top | #547e64 / #b2ba90 | Slab and readable landing edge |
| Action | #f79617 | Primary button, selected option |
| Seat 1 / 2 / 3 / 4 | #e83b3b / #4d9be6 / #fb6b1d / #905ea9 | Existing scarlet, cyan, gold, violet identities |

The gold seat remains orange in appearance and retains its existing alias. If a lighter city role is needed, bind another existing palette swatch through the role system and review its tests. Generated boards are not palette-conformance evidence.

Keep the vendored fonts: Press Start 2P for title/display text; Silkscreen for controls, names, and HUD. Begin at 32 logical px for screen headings, 16 for controls/body/HUD, and 24 for the primary floor readout. Avoid 8-pixel essential labels. Use the existing font metrics rather than copying the generated lettering.

Use an 8-unit spacing rhythm, 16-unit panel padding, a 2-unit outer border, and a restrained bevel. Focus gets a white outer ring with a dark separation gap. Secondary text must be tested for contrast; the current muted token is not automatically acceptable on every panel.

## Screen specifications

> **Amendment, 2026-09-19 — neon-grade chrome.** The project owner reviewed
> three further reference boards
> ([menu](explorations/2026-09-19/neon-chrome-menu.png),
> [gameplay](explorations/2026-09-19/neon-chrome-gameplay.png),
> [song select](explorations/2026-09-19/neon-chrome-song-select.png)) and chose
> to keep the approved dawn world unchanged while taking their **interface
> chrome**. This amendment is scoped to this section only. The world art rules,
> the palette table, the colour roles, and the acceptance gates above and below
> are unaffected: the sky stays pale and warm, the city stays hazy and quiet,
> and no building gains a light strip.
>
> **Taken from the boards.** Panels get a darker, heavier treatment: an opaque
> ink fill, a two-unit outer border, and a one-unit inner bevel highlight along
> the top and left, so a chip reads as a physical plate rather than as a tint
> over the sky. Numerals get more weight and more room than the labels beside
> them — a readout is a number with a caption, not a sentence. Standings become
> a real panel rather than a list, carrying seat mark, name, and a delta to the
> leader. The lap chip and the timer stack together at the right rather than
> sitting at opposite ends of the band.
>
> **Explicitly rejected**, and none of it may reach a runtime asset:
>
> | Rejected | Why |
> | --- | --- |
> | Decorative building text (未来, レース, English slogans) | The world rules already forbid new writing on buildings; at 960 × 540 it competes directly with the landing edges. |
> | Neon strips and glow on architecture | Reads as a lit, usable surface. Acceptance gate 3 requires that decorative roofs never imply a landing surface. |
> | Bloom on anything | Already forbidden above, and it is what makes the boards' platforms and their scenery indistinguishable. |
> | The visible LCD grille | The clean composite is the default; the panel effect stays an optional setting. |
> | A song-select screen | Outside the slice. Selecting among songs is Modes, Music, and Match Selection work, and the slice ships one song. |
> | "JUMP HIGHER" / "RACE JUMP REPEAT" signage | Bounce is automatic. The game must never imply a jump control it does not have. |
> | The boards' menu (START / MULTIPLAYER / OPTIONS / QUIT) | The menu is the name-and-room-code form specified below. No mode carousel, no account wall. |
> | Single-player framing (a health bar, a personal best, a character bust) | There is no health, and the slice's results come from authoritative standings. |
>
> The board's colour temperature is reference for *contrast relationships*, not
> for hue. Where a board uses a hot neon against near-black, the production
> equivalent is the existing action amber against the existing ink — the same
> separation, drawn from the palette the game already owns.

### Main menu

At 960 × 540, begin with a 32-unit side margin and a roughly 360-unit form column. Put the title above the form; reserve the opposite side for the four racers and rooftop art.

Order: name label and input, primary Create room, room-code label and input, secondary Join room. Keep visible labels, paste support, keyboard submission and error text near the relevant field. Do not show a matchmaking queue, account wall or mode carousel.

Primary buttons use amber fill and dark text. Secondary buttons use dark panel fill with a light outline. Pressed state shifts the face down 2 units; disabled and loading states have explicit labels as well as a visual change.

### Ready room

Show the room code and Copy action first. Four stable seat rows each show portrait or number, name, YOU/HOST where relevant, and Ready/Waiting/Open in text. Preserve focus and element identity when snapshots arrive.

Below the roster: the existing host-controlled 1/3 lap selection, readiness guidance, primary Ready/Not ready action and secondary Leave room. Starting the race still follows existing everyone-ready behavior; do not add a host-only Start button. Countdown takes visual priority when active.

### Gameplay HUD

The logical viewport is 960 × 540, but the current top/bottom crops leave y=54 through y=486 visible. Anchor HUD layout inside that band, not at y=0 as the concept images suggest.

Start with 16-unit visible-field insets: floor chip at (16,70), timer centered at x=480, lap chip right aligned at x=944. Keep the top chips about 40 units tall; place a compact four-row roster below the lap chip. Treat these as initial layout measurements to validate against real gameplay.

Floor readout reports collected floors, not altitude; use the same snapshot semantics as the current count. The timer uses the existing m:ss.t format and finished-player timing behavior. Standings preserve authoritative order. Remove the large translucent tally and player-adjacent timer only as part of this proposed HUD change.

Use a compact progress bar and seat identifier per roster row. Allow long names to truncate visually while preserving their full accessible label. Keep all HUD panels opaque enough for predictable readability.

**Amended layout (neon-grade chrome).** The band keeps the three readouts
spread across it as this section originally specified, and as Dawn Arcade lays
them out: floor chip at the left, elapsed time centred, lap chip right-aligned,
with the four-row standings panel below the lap chip.

An earlier revision of this amendment stacked the timer under the lap chip at
the right, borrowed from the neon boards. That is reverted. Dawn Arcade is the
approved direction and it centres the clock, and the three-across arrangement
also keeps each readout away from the two places a player actually looks —
their racer and the next landing edge — rather than massing all of them into
one corner.

The reference build's large translucent floor tally and its player-adjacent
timer are both removed by this change, which is what this section always
proposed.

Numerals in the floor readout and timer take the 24-unit size; their captions
take 16 and sit above or beside at reduced emphasis rather than matching the
number's weight. Each standings row carries the seat mark, the truncated name,
and a delta to the leader in the same `m:ss.t` format the timer uses, so a
player reads their position as a distance rather than as an ordinal alone.

Chips use the opaque ink fill, the two-unit outer border, and the one-unit top
and left bevel described in the amendment. No chip is translucent: a panel that
lets the city through is a panel a player has to read twice.

### Results and connection states

Results: winner headline, ordered four-seat list, per-player time/status, primary Race again and secondary Return to menu. Preserve server ordering and unfinished/disconnected status handling. Use the same seat marks as the lobby and HUD.

Connecting/reconnecting/error messages belong in the same panel system. Keep the typed name and room code after an error. Give failures a text description and the existing relevant recovery action; color alone must not carry status.

### Mobile

Menus reflow to a single column at narrow widths. Size interactive targets to at least 44 × 44 CSS pixels after layout; do not obtain mobile menus by shrinking the desktop form.

Gameplay retains the same clipped world view and camera rules. A portrait phone must not see more course. Surrounding space may carry scenery, status, or touch controls. Use left/right and fast-fall controls with labels; automatic bounce means there is no Jump button.

If the scaled gameplay HUD is unreadable in portrait, propose a separate screen-space HUD presentation fed by the same data. That is a layout change to implement and test, not a reason to widen the camera. Verify landscape and portrait separately.

## Asset handoff

| Deliverable | Production specification |
| --- | --- |
| Racer sheets | Four recolors, 32 × 32 frames, existing five-row animation layout |
| Portraits | Four 32 × 32 RGBA crops from approved idle art |
| Platform sheet | Existing 128 × 32 frames, two rows; collision-aligned top edge |
| Far / near city | 960 × 360 and 960 × 440 RGBA strips; continuous building bodies |
| Clouds / sun | 960 × 140 strip and 256 × 256 RGBA image |
| Lantern layer | Existing 960 × 440 alias; sparse accents coordinated with windows |
| Menu backdrop | 320 × 180, intended 3× logical upscale |
| Chip frame | 24 × 24 with existing 8-unit nine-slice insets |
| Title plate | 192 × 48, unlettered; live title typography |
| Seat/status/focus marks | Small code-native UI shapes; do not crop them out of concept boards |

Build backgrounds and chrome as controllable authored assets; use generated imagery as reference. Do not ship flattened mockups, generated text, or automatically downscaled boards as production art.

Production handoff must include source files, export dimensions, alpha checks, palette roles, provenance, and in-game captures. Keep aliases stable unless a reviewed change explicitly migrates the manifest and consumers.

## Review and implementation boundary

This direction supersedes conflicting visual instructions in the accepted
Resurrect Arcade brief for future production assets. It explicitly permits one
outfit shadow tone. Old size targets in prior specs must not override the
current 49.92-unit footprint. The accepted runtime remains unchanged until the
Exceptional Race Slice implements and approves the replacement assets.

A future implementation should proceed as a small visual slice first: one complete racer pose set, one platform, both skyline layers, the menu form, and a gameplay HUD. Validate that slice before producing all replacement art.

Acceptance gates:

1. At desktop and both mobile orientations, the local player and next platform are identifiable in a brief glance without relying on color alone.
2. Racers remain readable over sky, far city, near city and other racers; all four share alpha silhouette and draw scale.
3. Decorative roofs never imply a usable landing surface. The full platform edge remains visible.
4. Palette and manifest validation pass for production exports; concept PNGs remain outside the runtime manifest.
5. Keyboard focus, name/code input, error recovery, four-seat readiness and touch movement/fast fall remain operable.
6. Every essential text label meets the selected accessibility contrast target; measure rendered colors and final CSS text size.
7. The visible course, collision behavior, automatic bounce, wrap, lap choices, timing and server-owned results stay unchanged.
8. Review with clean presentation first, then optional LCD enabled; effects must not erase landing edges or UI text.
9. Run relevant client checks and capture desktop, mobile landscape and mobile portrait with four connected players. Profile effects in an actual race.

The concept work produced exploratory images and this approved brief. Runtime
code, palette bindings, shipped art, manifests, and accepted screenshot
baselines remain unchanged until the Exceptional Race Slice is implemented.
The slice's acceptance is governed by `docs/product-quality-standard.md` and
the project's internal notes.
