# Changelog

## 1.0.0 (2026-11-21)

The full release, no longer a candidate. The title now shows v1.0.0. The game
has been live on Ruken since 2026-11-20.

### The UI overhaul

- **One look for every menu.** Every screen is drawn from one panel (Plum Black at 85% over a light frost, a dark outline and a bevel) on the Resurrect 64 palette, with green for the one main action, red for stop and blue for the rest. White words hold 9:1 on the panel, over the brightest part of the city too.
- **It fits.** Every screen fits the ten views from an iPhone SE to a 1440 x 900 desktop, upright and sideways, in all six languages, and its type sits on the 12 px grid.
- **Full-window menus and the bars.** Menus fill the whole window; a race keeps the game's picture in its band with bars around it.
- **The logo.** A studio screen opens the game; the logo is off the splash and the title.
- A refusal chip marks its edge in the danger colour and keeps its words white, so they read.

## 1.0.0-rc.1 (2026-10-16)

The first release candidate for 1.0.0. It goes to staging and through the
release drills; 1.0.0 is cut from it, or from a later candidate, once the
owner signs off.

**Version.** `bump-version` took only `x.y.z`, so it now also takes
`x.y.z-rc.N` and `check-version` holds a `vx.y.z-rc.N` tag to it. The
candidate says what it is on the title, rather than borrowing 1.0.0 or a
0.x number that would never ship.

### Play

- **Survival is the hero mode.** Rooms open on Survival (1:00, 3:00 or 5:00 on the clock), marked FEATURED; the 20- and 50-floor races are a pick away.
- **Everything is earned by solo play** within ten matches, and the **After Hours** pack adds four DLC characters, translated into all six languages.
- **Clearer climbing.** Stranded floors are telegraphed with a mark and a cue, a bounce shows its apex (a settings toggle), and wall rides throw sparks, tilt the brace and scuff.
- On a phone held upright, a steering swipe can start on the racer pips.

### Fixes

- The impact flash and the Survival lava reach every edge of the screen.
- The FEATURED badge is at the 12 px label floor.

### Support

- Phone landscape is supported full screen only: the in-browser sideways sizes (780 x 270, 844 x 340, 667 x 320) are cut.

### Release

- The first-load budget before the title is 50 MiB, up from 8 MiB.
- D-R4: Ruken PROD is the only production client (no `play.` fallback); the game server runs on its own box, a Hetzner CAX11, built by `deploy/bin/provision-prod`.
