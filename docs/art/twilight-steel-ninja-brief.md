> **Superseded.** This brief is the record of the previous art direction and is
> not a runtime authority. `pnpm assets:check` enforces
> `docs/art/resurrect-arcade-brief.md`.

# Twilight Steel Ninja: Accepted Art Brief

This is the accepted PixelLab input for every runtime texture in Floor Fifty.
It is the authority the manifest schema and `pnpm assets:check` enforce; an
asset that does not match a row here does not ship.

No legacy texture from `References/FloorFiftyVerticalSlice/assets` is a
runtime dependency. Those files are evidence of the original build only.

## Art Direction

Pixel-art ninjas racing up a city skyline at indigo dusk.

- **Sky** is violet-indigo, darkest at the top, warming toward the horizon.
- **Sunset** is a peach and gold disc low in the frame, the only light source.
- **City** reads as flat charcoal silhouettes; the near layer is darker than
  the far layer so depth comes from value, not detail.
- **Highlights** are a restrained teal, used only on rim edges and the top
  surface of a platform. Teal is the readability budget: spend it where a
  player needs to judge a landing.
- **Scarves** are the four player colors, and they are the only saturated
  warm-versus-cool contrast on a character.

### Palette Roles

Roles, not hex values, are what an asset declares. `packages/asset-contract/src/palette.ts`
is the single source of the values behind them.

| Role | Value | Used for |
| --- | --- | --- |
| `skyDeep` | `#1a2148` | Upper sky |
| `skyMid` | `#2b3168` | Lower sky, canvas clear color |
| `sunsetPeach` | `#f2a06a` | Horizon wash |
| `sunsetGold` | `#ffd27f` | Sun disc core |
| `charcoal` | `#161a2b` | Near rooftops, character silhouette |
| `charcoalFar` | `#252a45` | Distant skyline |
| `tealEdge` | `#4fd6c4` | Rim light, platform top surface |
| `uiText` | `#f4f1e8` | Bitmap font, primary UI |
| `uiMuted` | `#9aa0c0` | Secondary UI rows |

| Scarf | Value |
| --- | --- |
| `scarlet` | `#e8425c` |
| `cyan` | `#41c7e8` |
| `gold` | `#f0c246` |
| `violet` | `#a36ce8` |

## Required Output

### Characters

Four sheets, one per scarf color, at **48 x 64** per frame. All four share one
silhouette and one animation timing; only the scarf color differs, so a player
reads position first and identity second.

| Animation | Frames | Duration |
| --- | --- | --- |
| `idle` | 4 | 600 ms |
| `run` | 6 | 480 ms |
| `jump` | 2 | 200 ms |
| `fall` | 2 | 200 ms |
| `land` | 3 | 240 ms |

Rows are laid out in that order, top to bottom, each row left-aligned at frame
zero. A sheet is therefore `6 * 48` wide by `5 * 64` tall, with unused frames
in a short row left fully transparent.

Aliases: `ninja.scarlet`, `ninja.cyan`, `ninja.gold`, `ninja.violet`.

### Platforms

One **128 x 32** frame sheet with a `stationary` and a `moving` variant, laid
out as two rows. The top surface carries the teal edge highlight. That
highlight is decoration only: collision is resolved against the simulation's
`FLOOR_WIDTH` and `FLOOR_HEIGHT` tunables and never against a pixel.

Alias: `world.platform`.

### Parallax

Five layers, each sized to tile horizontally across the 960 x 540 logical
viewport without a visible seam.

| Alias | Size | Notes |
| --- | --- | --- |
| `world.sky` | 960 x 540 | Opaque vertical gradient; the only layer without alpha |
| `world.sun` | 256 x 256 | Sun disc with a soft peach falloff |
| `world.cityFar` | 960 x 180 | Distant skyline in `charcoalFar` |
| `world.cityNear` | 960 x 220 | Foreground rooftops in `charcoal` |
| `world.lanterns` | 960 x 220 | Sparse warm lantern dots aligned to the near rooftops |

### UI

The `menu` bundle is declared and deliberately empty. The menu, the ready room
and the results are HTML, the HUD and nameplates are drawn with the renderer's
own text, and the touch buttons are styled DOM elements, so nothing in the
client addresses a UI sheet.

A bitmap font, an icon strip, touch-button art and a title mark were drawn and
carried here for a while without ever being rendered: they were downloaded on
every visit, validated on every build, and listed for art review as though they
were in the game. They have been removed rather than left to look finished.
Authoring real UI art means adding it back to this table, to the `menu` bundle,
and to the screen that draws it, in that order.

### Audio

Audio is **not** PixelLab output and is not defined here. The manifest declares
an `audio` bundle that is deliberately empty; the Production Experience
initiative fills it with codec, variants, duration, loudness, license, and loop
points. The validator accepts the empty bundle rather than treating it as a
missing one, so that initiative adds rows without changing the schema's shape.

## Hard Constraints

Every one of these is machine-checked by `pnpm assets:check`:

1. Every alias in this brief exists exactly once in the manifest.
2. Declared frame dimensions match the file on disk, accounting for the sheet
   layout above. A mismatch reports the alias with expected and actual sizes.
3. Every sprite has a real alpha channel and a fully transparent background.
   Opaque backgrounds are the single most common PixelLab export mistake.
4. Every character sheet declares all five animations. A missing `land` is a
   parse error, not a warning.
5. Every asset declares at least one palette role drawn from the table above.
6. Every asset carries provenance: the tool, the prompt, a source reference,
   and a license. An asset nobody can regenerate is an asset nobody can fix.

## Prohibited

- Copied or recognisable characters, logos, or trademarks.
- Baked typography inside a sprite. All text is drawn at runtime, so a
  translation never needs a re-render.
- Non-transparent sprite backgrounds.
- Any texture carried over from the Bevy reference build.

## Regeneration

The set is authored two ways, and each asset records which in its manifest
`provenance.tool`.

**`pnpm assets:generate`** procures the four character sheets from PixelLab. It
needs `PIXELLAB_API_KEY` in `.env.local` and an account with generation quota,
and it spends that quota, so it is a manual step rather than a build step.

**`pnpm assets:placeholder`** draws everything else: the parallax plates, the
platform, the sun, the title mark, the bitmap font, the icons, and the touch
buttons. That is how those assets are authored, not a stand-in for them:

- The generator caps an image at 400 pixels, and the plates are 960 wide and
  have to tile without a seam.
- Asked for an isolated prop, the generator returns a small scene. The sun came
  back as a landscape with an opaque sky and the platform as a city skyline, so
  both are drawn instead.

It never overwrites a character sheet that already exists, so running it after
`assets:generate` is safe. It draws character sheets only when generated ones
are absent, so a checkout without an API key still runs the game.

Prompts live with the asset, in its manifest `provenance.prompt`, so the
manifest alone is enough to re-render the generated half.

## Review

Automated checks establish that an asset is well-formed, never that it is
good. Human sign-off against this brief is recorded in
`docs/art/twilight-steel-ninja-review.md` and is a release gate.
