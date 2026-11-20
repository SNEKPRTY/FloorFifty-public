import type { RoleName } from "../../src/roles";

export type Plate = {
  readonly source: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /**
   * The only colours this plate may contain.
   *
   * Not the whole palette, which is the entire point. Quantising a pale
   * pastel illustration against all sixty-four swatches picks whatever is
   * nearest in RGB, and what is nearest to a hazy lavender tower turns out to
   * be candy pink, mint and orange -- which is a jumble rather than a distance.
   *
   * The layers are separated by value and saturation, by measurement: 85 of
   * luma and 34 points between `cityFar` and `cityNear`. That separation is
   * what parallax reads as depth, and it survives only if each plate is held
   * to its own role ramp. So the generator supplies the silhouette and the
   * density, and the palette supplies the colour.
   */
  readonly ramp: readonly RoleName[];
  /**
   * Empty sky kept above the rooflines, as a fraction of the drawn height.
   *
   * Cropping tight to the content puts the tallest roof on the plate's very
   * top row, and since the strip is bottom-anchored in the world that pushes
   * the whole city up the frame. The brief asks for roughly half the visible
   * field to be quiet sky at a representative camera, and both approved boards
   * are composed that way. Headroom is how the plate gives it back.
   */
  readonly headroom?: number;
  /**
   * The pixel grid the plate is snapped to, in output pixels.
   *
   * Two on the city plates. The racers are 32-pixel sheets drawn at about 50
   * logical units, so their own pixel is roughly a pixel and a half; a city on
   * a two-pixel grid sits in the same register as the characters in front of
   * it rather than carrying finer detail than anything else on screen, which
   * is one of the ways a converted illustration announces itself.
   */
  readonly grid?: number;
  /** Smallest shape kept, in output pixels. */
  readonly minShape?: number;
  /** Small detached alpha islands below this many pixels are encoder debris. */
  readonly minOpaqueArea?: number;
  /** Generated scenery subjects in these plates all rise from the bottom edge. */
  readonly requireBottomConnection?: boolean;
  /** Whether the last visible row must continue into a renderer-owned skirt. */
  readonly extrudeFoot?: boolean;
  /**
   * Assign each pixel to the nearest ramp swatch by colour instead of ranking
   * by value. For a ramp whose roles differ in hue rather than in light -- the
   * props' ink and foliage sit within a few points of luma of each other, so a
   * value ranking would split every tree down the middle.
   */
  readonly byColour?: boolean;
  /**
   * Join the source's right end onto its left start before converting, so the
   * strip tiles without a seam (`wrapSeamless`). A generated skyline never
   * meets itself on its own, and the renderer repeats every strip across the
   * frame, so its join is always on screen somewhere.
   */
  readonly seamless?: boolean;
  /**
   * Source rows dropped from the bottom before converting. For a source whose
   * foot is something other than the bodies above it -- snow banked against
   * the walls -- which the renderer's skirt would otherwise stretch into
   * streaks down the rest of the screen.
   */
  readonly footTrim?: number;
  /**
   * Roles repainted as the wall (`cityNear`) in the extruded foot, so the
   * skirt below continues as walls rather than as stripes of snow or lantern
   * light running down the screen.
   */
  readonly footQuiet?: readonly RoleName[];
  /**
   * The powdery finish (`powder.ts`) in place of the per-class simplify: the
   * whole-image 2x2 open and close the AutomataEngine unfaker settled on, then
   * a re-lock to the ramp. The stages' art carried it first; the tutorial's
   * Dawn and the menu followed (owner, 2026-10-01: "all assets"). The
   * dithered skies never take it: a 2x2 open erases one-pixel stipple.
   */
  readonly powder?: boolean;
};

export const PLATES: readonly Plate[] = [
  // The tutorial's near rooftops, in silhouette: one swatch is the whole point.
  {
    source: "dawn-near.png",
    powder: true,
    file: "world-dawn-near.png",
    width: 960,
    height: 440,
    ramp: ["outline"],
    headroom: 0.1,
    grid: 2,
    minShape: 8,
    minOpaqueArea: 64,
    requireBottomConnection: true,
  },
  // One value. "Remove dark outlines from far buildings" and let haze do the
  // work; a second tone here would start rebuilding the edge that rule removes.
  {
    source: "city-far.png",
    powder: true,
    seamless: true,
    file: "world-city-far.png",
    width: 960,
    height: 360,
    ramp: ["cityFar"],
    grid: 2,
    minShape: 8,
    minOpaqueArea: 64,
    requireBottomConnection: true,
  },
  // Body, its own value in shadow, and the lit windows. No sunlit fourth tone:
  // the lightest violet the palette offers is the violet seat itself, and a
  // building face at a racer's luma is the one collision the whole direction
  // is arranged to avoid.
  {
    source: "city-near-dense.png",
    powder: true,
    seamless: true,
    file: "world-city-near.png",
    width: 960,
    height: 440,
    // Darkest first: the ramp is indexed by luma rank.
    ramp: ["cityNearEdge", "cityNear", "cityWindow"],
    // The dense source's rooftops stop halfway up the image, so they need
    // little headroom to stand as tall as the boards' near city.
    headroom: 0.1,
    grid: 2,
    minShape: 8,
    // Every tower rises from the plate's foot, so anything not connected to it
    // is the encoder's atmosphere rather than a building -- and a stray opaque
    // fleck up in the sky reads as a bird, then as a platform edge, then as a
    // bug. The near plate carried a handful of them.
    minOpaqueArea: 64,
    requireBottomConnection: true,
  },
  {
    source: "city-mid-spires.png",
    powder: true,
    seamless: true,
    file: "world-city-mid.png",
    width: 960,
    height: 400,
    // One flat value and the windows, like the far plate. The middle skyline is
    // a distance layer, so it is a silhouette with lit panes rather than a body
    // with its own shaded return: two body values at this depth read as two
    // buildings touching, and the earlier ramp -- which put `rooftopDetails` in
    // the darkest band -- made the middle layer darker than the near one, the
    // depth ordering inverted.
    ramp: ["cityMid", "cityWindow"],
    // Little headroom: the spires are the point of this layer, and they have to
    // rise above the near rooftops in front of them (spec §2.8 item 8). The
    // sky above them is the sky plate's, not this plate's.
    headroom: 0.1,
    // Two pixels, like the other plates: this layer sits behind the near one and
    // must not carry more detail than the art in front of it.
    grid: 2,
    minShape: 8,
    // The source is a hazy illustration whose atmosphere keys as opaque, so
    // without this the plate ships with specks floating above its own rooftops.
    minOpaqueArea: 64,
    requireBottomConnection: true,
  },
  {
    source: "rooftop-details.png",
    powder: true,
    file: "world-rooftop-details.png",
    width: 960,
    height: 220,
    ramp: ["rooftopDetails"],
    headroom: 0.35,
    grid: 2,
    minShape: 4,
    minOpaqueArea: 16,
    requireBottomConnection: true,
    extrudeFoot: false,
  },
  // The two stages the select adds. Each layer is held to a ramp of existing
  // roles by colour: the sources differ in hue rather than in light (a red
  // torii, amber lanterns, green kelp), which a value ranking would flatten.
  // Snow Shrine's mountains and the pagoda (ascent board, 2026-09-30): a
  // violet-grey body, pale ridges and white caps, against a night sky.
  {
    source: "snow-shrine-far.png",
    powder: true,
    seamless: true,
    file: "world-snow-shrine-far.png",
    width: 960,
    height: 360,
    ramp: ["uiMuted", "dawnHigh", "dawnGlow", "cloud"],
    headroom: 0.1,
    grid: 2,
    minShape: 8,
    minOpaqueArea: 64,
    requireBottomConnection: true,
    byColour: true,
  },
  // The cedar forest and its stair (the ascent board's middle layer): navy
  // trees with a dull snow dusting. Not white: white is the shrine platform's
  // top, and nothing this far back may read as somewhere to land.
  {
    source: "snow-shrine-mid.png",
    powder: true,
    seamless: true,
    file: "world-snow-shrine-mid.png",
    width: 960,
    height: 400,
    ramp: ["cityNear", "cityMid", "dawnHigh"],
    headroom: 0.05,
    grid: 2,
    minShape: 8,
    minOpaqueArea: 64,
    requireBottomConnection: true,
    byColour: true,
  },
  // The shrine's sparse details on one baseline: stone lanterns, a plaque
  // rack, a bell, snow-laden boughs. Dark stone and wood, a red-lacquer trim,
  // and the same dull snow as the cedars.
  {
    source: "snow-shrine-details.png",
    powder: true,
    file: "world-snow-shrine-details.png",
    width: 960,
    height: 220,
    ramp: ["outline", "uiChipEdge", "uiMuted", "dawnHigh", "floorPending"],
    headroom: 0.35,
    grid: 2,
    minShape: 4,
    minOpaqueArea: 16,
    requireBottomConnection: true,
    byColour: true,
  },
  // Snowy shrine roofs: navy and its lighter trim, white snow, one red torii, amber lanterns.
  {
    source: "snow-shrine-near.png",
    powder: true,
    seamless: true,
    footTrim: 48,
    footQuiet: ["dawnGlow", "cityWindow"],
    file: "world-snow-shrine-near.png",
    width: 960,
    height: 440,
    // Snow in a pale tone short of white: white is the shrine platform's top,
    // and a roofline as bright as a landing edge reads as one (ascent board
    // interpretation, "snow-covered roof ridges").
    ramp: ["cityNearEdge", "cityNear", "cityMid", "dawnGlow", "floorPending", "cityWindow"],
    headroom: 0.1,
    grid: 2,
    minShape: 8,
    minOpaqueArea: 64,
    requireBottomConnection: true,
    byColour: true,
  },
  // Sunken Dome's distant spired city: one pale teal and its lit panes.
  {
    source: "sunken-dome-far.png",
    powder: true,
    file: "world-sunken-dome-far.png",
    width: 960,
    height: 360,
    ramp: ["dawnTeal", "cityWindowHot"],
    headroom: 0.1,
    grid: 2,
    minShape: 8,
    minOpaqueArea: 64,
    requireBottomConnection: true,
    byColour: true,
  },
  // Rooftops' horizon (extended-stage.png, "Open-sky finish"): a misted
  // skyline on a strip of water, pale and flat. Short, because the source
  // draws it as a thin band and a plate is filled by its drawn rows: at the
  // board's proportions it is about this tall.
  {
    source: "rooftops-horizon.png",
    powder: true,
    seamless: true,
    // The source's glints hang in open key below the water line; trimmed, so
    // the foot is the solid water and the towers stand on it.
    footTrim: 26,
    file: "world-rooftops-horizon.png",
    width: 960,
    height: 120,
    ramp: ["cityFar", "skyHigh", "cloud"],
    headroom: 0.1,
    grid: 2,
    minShape: 4,
    minOpaqueArea: 16,
    requireBottomConnection: true,
    byColour: true,
  },
  // The dome's glass ribs and the kelp between them (the ascent board's middle
  // layer): dark slate ribs and dark kelp, so they read behind the coral and
  // move against it. Two lights at most, in the window swatch.
  {
    source: "sunken-dome-mid.png",
    powder: true,
    seamless: true,
    file: "world-sunken-dome-mid.png",
    width: 960,
    height: 400,
    ramp: ["outline", "cityNear", "rooftopFoliage", "cityWindow"],
    headroom: 0.05,
    grid: 2,
    minShape: 8,
    minOpaqueArea: 64,
    requireBottomConnection: true,
    byColour: true,
  },
  // Coral, glass tubes and lit portholes (ascent board). The coral is muted
  // onto violet-grey and pink: the board's saturated coral would outshine the
  // platform tops, which are pale glass (`dawnGlow`), so no scenery uses that.
  {
    source: "sunken-dome-near.png",
    powder: true,
    seamless: true,
    file: "world-sunken-dome-near.png",
    width: 960,
    height: 440,
    ramp: ["outline", "cityNear", "dawnFog", "dawnTeal", "uiMuted", "skyMid", "cityWindow"],
    footTrim: 24,
    footQuiet: ["skyMid", "uiMuted", "cityWindow"],
    headroom: 0.1,
    grid: 2,
    minShape: 8,
    minOpaqueArea: 64,
    requireBottomConnection: true,
    byColour: true,
  },
  // Sunken Dome's sparse details on one baseline: anemones, a bubble column,
  // the diving bell, a coral fan. Brass in the dim window orange, which the
  // window codes do not key on, so the bell does not flicker.
  {
    source: "sunken-dome-details.png",
    powder: true,
    file: "world-sunken-dome-details.png",
    width: 960,
    height: 220,
    ramp: ["outline", "uiMuted", "dawnTeal", "skyMid", "cityWindowDim"],
    headroom: 0.35,
    grid: 2,
    minShape: 4,
    minOpaqueArea: 16,
    requireBottomConnection: true,
    byColour: true,
  },
  // Placeholder props for the details strip (launch polish, phase 1): water
  // towers, aerials, spires and planters, generated with gpt-image-2.5-flare.
  // Ink for structure and one dark teal-green for foliage -- never the grass
  // green of a platform's top face. Replaced by hand-authored art in phase 6.
  {
    source: "rooftop-props.png",
    powder: true,
    file: "world-rooftop-props.png",
    width: 960,
    height: 220,
    ramp: ["rooftopDetails", "rooftopFoliage"],
    // Deep headroom scales the props down: they stand on the nearest roofs and
    // must read as fixtures there, not as towers taller than the buildings.
    // (Bounded by the source: it has about one plate-height of empty rows
    // above the props, so a larger value shrinks them no further.)
    headroom: 1.0,
    grid: 2,
    minShape: 4,
    minOpaqueArea: 16,
    requireBottomConnection: true,
    extrudeFoot: false,
    byColour: true,
  },
];




/**
 * Maps every opaque pixel onto the plate's ramp.
 *
 * Two passes, because the source encodes two different things two different
 * ways, and a single nearest-colour search conflates them.
 *
 * *Lit windows are warm, not bright.* In the source the walls are pale cream
 * and lavender at a luma around 210, while a lit window is amber at about 180.
 * Nearest-by-luma therefore calls every wall a window and paints the city
 * orange, which is exactly what it did. What actually separates a lit window
 * from a wall is saturation and hue, so that is what selects them.
 *
 * *Everything else is ranked, not matched.* The source's values live between
 * 120 and 230; the ramp's live between 52 and 82. There is no meaningful
 * absolute distance between those two scales, so the remaining pixels are
 * split at their own median: the darker half is the shaded return, the lighter
 * half is the lit body. That keeps the relationship the illustration drew --
 * which face is in shadow -- while the palette decides what the two values are.
 */
/**
 * The 4x4 ordered dither matrix, normalised to -0.5..0.5.
 *
 * Bayer rather than noise: a sky is a slow gradient across a wide plate, and a
 * random threshold there reads as grain while an ordered one reads as a woven
 * transition, which is what pixel art has always used a limited palette for.
 */
