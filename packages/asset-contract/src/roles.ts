/**
 * Semantic palette roles for the Resurrect Arcade direction.
 *
 * A role binds to a swatch *index*, never to a hex value: a re-render may move
 * a role onto a different swatch without touching a manifest row, and no caller
 * anywhere in the repository authors a colour of its own.
 *
 * Every index below was chosen by measuring the palette rather than by eye, and
 * each comment records the measurement that decided it. "Luma" is Rec. 601,
 * which is what the brief and the tests both mean by a step of value.
 *
 * These bindings were re-derived when the direction was reframed against the
 * design reference. The field is high-key now rather than dusk: the sky is a
 * bright pastel field, and separation comes from a heavy dark outline on every
 * foreground element rather than from dropping the background into shadow. The
 * bindings that moved are `skyHigh`, `skyLow`, `cityWindow` and the gold seat,
 * and each says below why.
 */

import { RESURRECT64, swatchRgb, type SwatchIndex } from "./swatches";

export const ROLES = {
  /**
   * The top of the sky field.
   *
   * `#8fd3ff`, luma 196. Pale blue rather than the saturated yellow this role
   * first carried: under a high-key direction the sky is the quietest thing on
   * screen, not the loudest, and every racer has to stay readable against it.
   */
  skyHigh: 48,
  /**
   * The sky between overhead and the horizon: the dawn band.
   *
   * `#eaaded`, luma 199 -- a pale lilac, and the one swatch the palette offers
   * that sits between the two sky tones by value (196 against 215) without
   * leaving the sky's temperature. The field is otherwise a two-step dither
   * between `skyHigh` and `skyLow`, which reads as a flat pale blue rather than
   * as a dawn: a real pre-sunrise sky runs blue overhead, pink through the
   * middle and peach at the horizon, and the accepted Aquarian board draws all
   * three. Two tones cannot carry a three-zone gradient, which is why this role
   * exists.
   *
   * Chosen by measurement over colour. Every other swatch in the luma band
   * between the two sky tones is a mint, a yellow-green or an amber -- the
   * palette's aqua and lime ends -- and any of them would put a green or an
   * orange stripe through a blue-to-peach field. Salmon (`#fca790`) and amber
   * (`#fbb954`) are the right warmth but sit *below* `skyHigh` at 190 and 193,
   * so either would invert the gradient.
   */
  skyMid: 53,
  /**
   * The sky at the horizon, warmer and lighter than overhead.
   *
   * `#fdcbb0`, luma 215, hue 21 against `skyHigh`'s 204. Cool above and warm at
   * the horizon is what a real sky does, and the 19 of luma between them is
   * what the Bayer dither has to work across. The name is about position in the
   * field, not about value: the horizon is the lighter of the two.
   */
  skyLow: 63,
  /**
   * Cloud puffs.
   *
   * `#ffffff`, the only thing on screen lighter than the sky. Clouds are the
   * reference's signature and they are why the sky can be pale without going
   * flat: they give it a scale and a parallax layer of its own.
   */
  cloud: 9,
  /**
   * Distant skyline: cool, low saturation, hazed toward the sky.
   *
   * `#9babb2`, luma 167 at 13% saturation -- 26 below the sky it sits against.
   * Deliberately light rather than dark: a far layer hazed toward the sky is
   * atmospheric perspective, and silhouette-against-dark is the failure this
   * direction corrects.
   */
  cityFar: 7,
  /**
   * The middle skyline: blue, and between the other two by value.
   *
   * `#4d65b4`, luma 102 at hue 226 -- 65 below `cityFar` and 48 above
   * `cityNear`. The launch polish re-grade (spec 2.4.2) measured the
   * extended-stage board's depth ladder at about 170 / 110 / 45 and asked for
   * the skylines to step from pale blue-grey to deep slate-navy; the violet
   * slate `#7f708a` this role carried read as a warm band between two cool
   * ones. Blue, a step deeper, is the board's middle distance.
   */
  cityMid: 46,
  /**
   * The rooftop props: vents, aerials, water tanks, small planters.
   *
   * `#2e222f`, luma 39 -- the palette's minimum, and the darkest thing in the
   * scenery. These are the nearest scenery layer of all, in front of the near
   * skyline, so they have to sit below it rather than beside it.
   *
   * Sharing the swatch with `outline` is the safe end of the trade: a prop drawn
   * in the same ink as every foreground edge cannot be mistaken for a lit
   * surface or a landing lip, which is the one failure a layer this close to the
   * play field is capable of causing.
   */
  rooftopDetails: 0,
  /**
   * Rooftop planters and trees on the placeholder props strip.
   *
   * `#165a4c`, luma 75 at hue 168 -- a dark teal-green. Dark because it is
   * scenery in front of the near skyline, and teal rather than grass because
   * the platform top is the grass: a green prop within reach of that hue would
   * read as somewhere to land. It clears both top faces by more than the
   * closest accepted seat pair (weighted distance 112).
   */
  rooftopFoliage: 29,
  /**
   * Near skyline: the closest city mass, and the one the play field reads
   * against.
   *
   * `#323353`, luma 53 at hue 238 -- deep slate-navy, the board's near rooftops
   * (measured at 42 to 48 of luma, blue).
   *
   * Its history is a series of corrections, and this one reverses the last of
   * them for a measured reason. It was `#6b3e75`, then `#45293f` (right value,
   * brown), then `#3e3546` (58, slate), then `#625565` at 91 on the judgement
   * that the board's near city was a light blue-slate. Measuring the board for
   * the launch polish program (spec 2.4.2) put the near rooftops at 42 to 48 and
   * blue: the light blue-slate masses are its *middle* skyline, which is now
   * `cityMid`'s job. The layer that was too dark before was too dark because it
   * was the only city mass; with a pale far layer and a blue middle one behind
   * it, a deep near layer is depth rather than silhouette.
   *
   * Every seat clears it by more than it cleared `#625565`, and the platform
   * body at 115 now stands 62 above it.
   */
  cityNear: 44,
  /**
   * The near skyline's own edge.
   *
   * `#2e222f`, luma 39: 52 below the body it shades.
   *
   * The brief asks for a local-value edge on the near city rather than a border
   * drawn round it, because an edge with its own weight promotes a rooftop to
   * the rank of a platform. That is still what this is -- a shaded return, and
   * the ink the whole direction's outlines are cut from -- but the step is much
   * larger than it was, because the wall it shades went from near-black to
   * slate and the edge stayed where the palette's floor is. It is the one part
   * of the near city that still reads as a silhouette, and it is what keeps the
   * buildings' forms legible against a lighter wall.
   */
  cityNearEdge: 0,
  /**
   * Lit windows, and the key the city bloom reads.
   *
   * `#f79617`, amber rather than the yellow it first carried. Against a pale
   * sky a yellow window was the same value as the field behind it; amber reads
   * as lit against both the purple buildings and the sky. It also has to stand
   * clear of everything else drawn, because the bloom claims any pixel within
   * 0.08 of it in unit RGB: its nearest neighbour in the finished frame is the
   * gold racer at 0.17, and the sky at 0.28.
   */
  cityWindow: 17,
  /**
   * The window ramp: the tones a lit window breathes between.
   *
   * The Aquarian board's windows are not one colour. A few burn pale yellow,
   * most are amber, some have sunk to a low orange -- a city where people are
   * home at different hours. These are that ramp, and they are the swatches
   * either side of `cityWindow` along the palette's own warm run, so a window
   * stepping between them never leaves the palette or the temperature:
   * `#fb6b1d` (luma 131) below it, `#f9c22b` (luma 196) and `#fbff86` (luma
   * 239) above. Output only: nothing keys on them, so they are free to sit
   * near a racer's colour.
   */
  cityWindowDim: 16,
  cityWindowBright: 18,
  cityWindowHot: 28,
  /**
   * Platform body. `#547e64`, luma 111: mid-value, and cool against the sky.
   *
   * Green, which is what both approved boards draw and what the brief's own
   * palette table always said. It was briefly a dark girder with a hot yellow
   * edge, on the reasoning that the landing edge had to outrank a busy city.
   * That was solving the right problem in the wrong place: the boards keep
   * their green slabs legible by keeping the city *dark*, not by making the
   * platform hotter than everything in it.
   */
  platformBody: 36,
  /**
   * Platform top face. The surface a landing is judged against.
   *
   * `#91db69`, luma 195 at hue 99 -- the lit grass green of the extended-stage
   * board, whose top face samples at rgb(186,218,159), hue 94 (launch polish
   * spec, phase 1). It was `#b2ba90`, a sage at hue 71 that read as stone
   * beside the board. 80 above the body, and 46 above the collected-floor mark
   * it hangs over, which is the contract's 40 with room.
   *
   * It reads against the city by 127 now rather than by 28, and none of that
   * came from changing this value. It came from the city going dark, which is
   * the arrangement both boards use.
   */
  platformTop: 32,
  /**
   * The lip under a platform's top face.
   *
   * `#92a984`, luma 158: between the bright top face at 179 and the body at
   * 111, so the edge steps down into the slab instead of stopping dead. Both
   * boards draw a platform as a lit surface with a thickness, not as a line on
   * a box. `#1ebc73` is the only other green in the gap and it is already the
   * collected-floor mark, which is read for something else entirely.
   */
  platformGlow: 37,
  /**
   * The top face of a moving platform.
   *
   * `#d5e04b`, luma 204 at hue 64. Distinguished from the static edge by being
   * brighter and more acid within the same green family, rather than by a
   * different hue: a moving floor is still a floor, and the boards give every
   * landing surface the same colour language.
   */
  platformMovingTop: 27,
  /**
   * A floor the local player has already landed on.
   *
   * `#1ebc73`, the palette's one bright, saturated green -- 72% saturation at
   * luma 133. It stands in for `platform_indicators.rs:109`'s `Color::GREEN`,
   * and it is a role of its own rather than a second use of `platformTop`
   * because the two are read for opposite things. `platformTop` is the surface
   * the bar hangs beneath, at luma 179 and 14% saturation; a bar painted in it
   * was the same colour as the floor above it and only 17 of luma from the sky
   * behind it, so the one mark that reports progress dissolved into both.
   */
  floorTaken: 31,
  /**
   * A floor the local player still owes a landing.
   *
   * `#ea4f36`, luma 123, for `platform_indicators.rs:112`'s `Color::ORANGE_RED`.
   * Not the palette's literal nearest swatch to it: that is `#fb6b1d`, and its
   * hue is 21 degrees -- the same hue as `skyLow`, which is the field the bar
   * hangs in front of at the horizon. `#ea4f36` is the next nearest and it sits
   * clear of the sky in hue as well as in value.
   *
   * It is also a role of its own rather than a second use of `cityWindow`,
   * which it used to borrow: that role is the key the city bloom measures
   * against, and a progress bar is not a lit window.
   */
  floorPending: 12,
  /**
   * A missed floor below the racer, recoverable by descending in a finite race.
   *
   * `#6e2727`, deep muted crimson at luma 60. Darker and distinctly more muted
   * than `floorPending` (`#ea4f36`, luma 123) and `floorTaken` (`#1ebc73`, luma 133),
   * paired with a downward recovery arrow; never a dead-platform mark.
   */
  floorStranded: 10,
  /**
   * Platform outline and underside. `#2e222f`, luma 39.
   *
   * The palette's minimum, 19 below the girder body it borders. It was a cool
   * slate at luma 53 while the body was a mid-value green; against a dark body
   * that left five points between the mass and its own edge, and the slab lost
   * its silhouette against the city. Ink is what gives a dark platform a
   * bottom.
   */
  platformOutline: 0,
  /**
   * Universal foreground outline. The darkest swatch in the palette.
   *
   * `#2e222f`, luma 39, which is the palette's minimum. Under this direction it
   * is the load-bearing role: every foreground element carries a heavy border
   * of it, and that border -- not a dark background -- is what separates figure
   * from ground.
   */
  outline: 0,
  /** Fill of a UI chip panel. `#3e3546`, dark enough to carry white type. */
  uiChipFill: 1,
  /**
   * Edge of a UI chip panel.
   *
   * `#625565`, luma 91 -- lighter than the fill it surrounds, so the chip reads
   * as a bevelled plate between the dark outline and the dark centre.
   */
  uiChipEdge: 2,
  /** Primary UI and HUD text. `#ffffff`, on chip fill at 197 of contrast. */
  uiText: 9,
  /** Secondary UI rows. `#7f708a`, muted against `uiText` but clear of the fill. */
  uiMuted: 6,
  // The tutorial's dawn (tutorial stage spec §2, and `dawn-concept.png`).
  // Stippled in pairs by `quantizeDithered`, so the palette's lack of a pale
  // teal is made up by mixing `dawnHigh` with `dawnTeal`.
  /** The violet-grey at the top of the sky. */
  dawnHaze: 6,
  /** The grey-teal the sky fades through. */
  dawnHigh: 7,
  /** The pale haze around the sun, and the mist's lightest tops. */
  dawnGlow: 8,
  /** The sun's warm glow. */
  dawnSun: 63,
  /** The sun's bright core. */
  dawnSunCore: 9,
  /** The teal of the pyramid, the fog and the mist. */
  dawnTeal: 41,
  /** The deeper teal at the foot of the fog. */
  dawnFog: 40,
  /**
   * Racer dust: the puff of a bounce, the ring of a slam, the bursts at a
   * spawn (polish spec §4.2).
   *
   * `#ab947a`, a sandy grey that reads as grit rather than as light. Floor
   * faces and skies run from dark to pale, so the best any swatch manages
   * against all four of the top face, the body, the low sky and the near city
   * is about 1.65:1. This is 1.59:1 at its worst. The three that measure higher
   * are two teals (the platforms' hue family) and a lavender beside the violet
   * seat, none of which reads as dust. A stage that swallows it names another
   * role in `juice.toml`.
   */
  dust: 4,
  /**
   * The highlight in the finish burst, which is otherwise the winner's seat
   * colour (polish spec §4.2).
   *
   * `#fbff86`, the pale yellow the hottest windows use: every third particle
   * glints in it. It is off every seat colour, so it never reads as another
   * racer.
   */
  finishBurst: 28,
} as const satisfies Record<string, SwatchIndex>;

export type RoleName = keyof typeof ROLES;

/**
 * The four player colours.
 *
 * These cover a racer's whole outfit rather than a scarf: a scarf-sized patch
 * is not identifiable at sprite scale in motion, which is the specific defect
 * the previous direction shipped with.
 *
 * All four sit at least 52 of luma below both sky swatches, because a racer is
 * seen against the sky and against the city in the same second, and they are
 * spread across the hue circle as far as a palette this warm allows.
 */
export const PLAYER_COLORS = {
  /** `#e83b3b`, hue 0, luma 111. */
  scarlet: 15,
  /** `#4d9be6`, hue 209, luma 140. Blue rather than teal, which the platforms hold. */
  cyan: 47,
  /**
   * `#fb6b1d`, hue 21, luma 141.
   *
   * Vivid orange rather than the amber this seat first carried. A bright sky
   * put that amber 32 of luma from the field behind it, under the 40 the
   * contract requires; dropping the seat rather than dimming the sky is what
   * keeps the direction high-key.
   */
  gold: 16,
  /** `#905ea9`, hue 280, luma 118. Reads against `cityNear` by 36 of luma. */
  violet: 51,
} as const satisfies Record<string, SwatchIndex>;

export type PlayerColorName = keyof typeof PLAYER_COLORS;

/** The hex value behind a role, for a caller that styles rather than draws. */
export function roleHex(role: RoleName): string {
  const swatch = RESURRECT64[ROLES[role]];
  if (swatch === undefined) throw new Error(`role ${role} is bound to no swatch`);
  return swatch;
}

/** The hex value behind a player colour. */
export function playerColorHex(color: PlayerColorName): string {
  const swatch = RESURRECT64[PLAYER_COLORS[color]];
  if (swatch === undefined) throw new Error(`player colour ${color} is bound to no swatch`);
  return swatch;
}

/** The 24-bit integer Pixi tints expect. */
export function roleTint(role: RoleName): number {
  const [r, g, b] = swatchRgb(ROLES[role]);
  return (r << 16) | (g << 8) | b;
}

/** The 24-bit integer Pixi tints expect, for a player colour. */
export function playerColorTint(color: PlayerColorName): number {
  const [r, g, b] = swatchRgb(PLAYER_COLORS[color]);
  return (r << 16) | (g << 8) | b;
}
