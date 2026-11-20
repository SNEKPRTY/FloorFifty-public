import { PNG } from "pngjs";
import { ROLES, type RoleName } from "../../src/roles";
import { swatchRgb } from "../../src/swatches";

export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((value) => value / 16 - 0.5));


export function quantize(
  png: PNG,
  ramp: readonly RoleName[],
  hasLit = true,
  dither = false,
): void {
  const colour = (role: RoleName): readonly [number, number, number] => swatchRgb(ROLES[role]);
  const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

  const paint = (i: number, [r, g, b]: readonly [number, number, number]): void => {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
  };

  // A single-value ramp is a silhouette: no classification to do.
  if (ramp.length === 1) {
    const only = colour(ramp[0]!);
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      paint(i, only);
    }
    return;
  }

  // The last role of a multi-colour ramp is the lit one when the plate has
  // windows; a ramp with no lit role passes `hasLit: false` and every pixel is
  // ranked. Everything before it is a value ramp, darkest first.
  const windowRole = hasLit ? ramp[ramp.length - 1]! : undefined;
  const valueRoles = hasLit ? ramp.slice(0, -1) : [...ramp];

  // Warm and saturated enough to be a lit pane rather than a painted wall.
  const isLit = isLitPixel;

  // Smoothed before it is split, and this is the difference between a shaded
  // wall and a mottled one. The illustration grains its surfaces slightly; a
  // per-pixel threshold turns that grain into blotches, because half of it
  // falls either side of the line. Averaging over a small window first lets a
  // whole face resolve to one side, and leaves a real edge -- where the change
  // is far larger than the grain -- exactly where it was.
  const RADIUS = 2;
  const smooth = new Float64Array(png.width * png.height);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
        for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= png.width || ny >= png.height) continue;
          const j = (ny * png.width + nx) * 4;
          if (png.data[j + 3] === 0) continue;
          sum += luma(png.data[j]!, png.data[j + 1]!, png.data[j + 2]!);
          count += 1;
        }
      }
      smooth[y * png.width + x] = count === 0 ? 0 : sum / count;
    }
  }

  const levels: number[] = [];
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    const [r, g, b] = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
    if (isLit(r, g, b)) continue;
    levels.push(smooth[i / 4]!);
  }
  levels.sort((a, b) => a - b);

  // Cut points by rank, not by value.
  //
  // The source's values and the ramp's live on different scales, so an
  // absolute distance between them means nothing. Ranking splits the drawn
  // range into as many bands as the ramp has colours, which preserves the
  // relationship the illustration drew -- which face is in shadow -- and lets
  // the palette decide what each band is.
  //
  // A two-colour ramp cuts at 32% rather than at the midpoint. An even split
  // puts as much of a city in shade as in light, which reads as a chequerboard
  // rather than as buildings with sun on one side; a shaded return is the
  // minority face.
  const cuts: number[] = [];
  for (let index = 1; index < valueRoles.length; index += 1) {
    const share =
      valueRoles.length === 2 ? 0.32 : index / valueRoles.length;
    cuts.push(levels[Math.floor(levels.length * share)] ?? 0);
  }

  const bands = valueRoles.map(colour);
  const lit = windowRole === undefined ? undefined : colour(windowRole);

  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue;
    const [r, g, b] = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
    if (lit !== undefined && isLit(r, g, b)) {
      paint(i, lit);
      continue;
    }
    const level = smooth[i / 4]!;
    let band = 0;
    while (band < cuts.length && level >= cuts[band]!) band += 1;

    // Dither, and only where it earns its place.
    //
    // Against the width of the band the pixel is actually in, not an average
    // of them all: the cuts are ranked, so a sky-dominated plate packs many
    // narrow bands into the sky and a few wide ones into the buildings. Using
    // the mean width pushed sky pixels across several bands at once and turned
    // the whole field into the high-contrast checkerboard the brief rejects.
    //
    // And only in the upper half of the ramp. A gradient is what dithering is
    // for; a dark building face is meant to be flat, and dithering one is just
    // noise on a wall.
    if (dither && cuts.length > 0 && band >= Math.ceil(bands.length / 2)) {
      const lower = band > 0 ? cuts[band - 1]! : levels[0]!;
      const upper = band < cuts.length ? cuts[band]! : levels[levels.length - 1]!;
      const width = Math.abs(upper - lower);
      const pixel = i / 4;
      const x = pixel % png.width;
      const y = Math.floor(pixel / png.width);

      let dithered = level + BAYER[y % 4]![x % 4]! * width;
      band = 0;
      while (band < cuts.length && dithered >= cuts[band]!) band += 1;
    }

    paint(i, bands[band]!);
  }
}

/**
 * Whether a source pixel is a lit pane rather than a painted wall.
 *
 * Amber: red leads, blue trails it clearly, and the pixel is *strongly*
 * saturated -- not merely warm. The threshold is 0.55 rather than 0.28 because
 * a dawn sky is warm too: at the lower setting the menu backdrop's peach
 * horizon cleared the test and the whole horizon came back painted in the
 * lit-window colour. A lit pane is near-pure amber at roughly 0.9; a pastel sky
 * sits around 0.3, and the gap between them is where this line belongs.
 */
export function isLitPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return false;
  const saturation = (max - min) / max;
  return saturation > 0.55 && r >= g && g > b && r - b > 60;
}

/** The sky's tones, overhead to horizon, and the pane the clouds are drawn in. */
export const SKY_TONES: readonly RoleName[] = ["skyHigh", "skyMid", "skyLow", "cloud"];

/** The city's tones, darkest to lightest. */
export const CITY_TONES: readonly RoleName[] = ["cityNearEdge", "cityNear", "cityMid", "cityFar"];

/** How far a pixel must fall below its row's level to be a building rather than sky. */
export const SKY_MARGIN = 38;

/**
 * How hard the sky ramp leans toward its cool end.
 *
 * The source sky is pale for most of its height, so a directly proportional
 * ramp spends the field in the warm middle band and leaves the blue as a strip
 * at the top. Above one, the blue holds longer and the warm bands gather at the
 * horizon, which is the arrangement the board uses.
 */
export const SKY_RISE = 1.9;

/**
 * Maps a whole scene -- sky and city in one picture -- onto the palette.
 *
 * The menu backdrop is the only plate that is a scene rather than a subject,
 * and one rule cannot serve both halves of it:
 *
 * - The **sky** is a smooth vertical gradient, and a gradient is exactly what
 *   an ordered dither is for. Its pixels are placed along a ramp of sky tones
 *   by their own value, stippled at the pixel's position.
 * - The **city** is hard-edged mass, so it is split into flat bands by rank --
 *   the same treatment the skyline plates get. Dithering a building face is
 *   just noise on a wall.
 *
 * Classifying them at all is the part that earns its place. A rank split over
 * the whole picture cannot tell the source's deep top-of-sky blue from a
 * building, because at that height they are the same value; the first cut of
 * this plate came out with its skyline where its sky should be, and the fix is
 * to decide which is which before choosing a tone rather than after.
 *
 * The classification is deliberately conservative, because the two mistakes are
 * not equally bad. A sky pixel called a building is one dull pixel near the
 * horizon. A building called sky is a hole in the city, so a pixel is only sky
 * when it sits within `SKY_MARGIN` of the value the sky holds *in its own row*,
 * measured at the 85th percentile where a minority of buildings cannot drag the
 * estimate down -- and never below the row where the picture is mostly city.
 */
export function quantizeScene(png: PNG): void {
  const W = png.width;
  const H = png.height;
  const pixel = (x: number, y: number): readonly [number, number, number] => {
    const i = (y * W + x) * 4;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
  };
  const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

  /** The value the sky holds in each row, robust to the buildings in it. */
  const rowLevel = new Float64Array(H);
  for (let y = 0; y < H; y += 1) {
    const values: number[] = [];
    for (let x = 0; x < W; x += 1) {
      const [r, g, b] = pixel(x, y);
      values.push(luma(r, g, b));
    }
    values.sort((a, b) => a - b);
    rowLevel[y] = values[Math.floor(values.length * 0.85)] ?? 0;
  }

  // The row the first building appears at, and the row the picture becomes
  // mostly building. Above the first, the picture is sky outright and nothing
  // about it needs classifying -- which matters, because the source's cloud
  // bands are darker than the blue behind them in places, and the threshold
  // below would call those clouds buildings and paint them in the city's grey.
  // Between the two, the threshold decides, which is what separates a rooftop
  // from the lit sky between two rooftops.
  let skyFloor = H;
  for (let y = 0; y < H; y += 1) {
    let dark = 0;
    for (let x = 0; x < W; x += 1) {
      const [r, g, b] = pixel(x, y);
      if (luma(r, g, b) < 140) dark += 1;
    }
    if (dark > W * 0.005) {
      skyFloor = y;
      break;
    }
  }

  let cityLine = H;
  for (let y = 0; y < H; y += 1) {
    let dark = 0;
    for (let x = 0; x < W; x += 1) {
      const [r, g, b] = pixel(x, y);
      if (luma(r, g, b) < 120) dark += 1;
    }
    if (dark > W * 0.5) {
      cityLine = y;
      break;
    }
  }

  /** Sky, by the two rules above: outright above the roof, by value below it. */
  const isSky = (level: number, y: number): boolean =>
    y < skyFloor || (y < cityLine && level >= rowLevel[y]! - SKY_MARGIN);

  const skyLumas: number[] = [];
  const cityLumas: number[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [r, g, b] = pixel(x, y);
      const level = luma(r, g, b);
      (isSky(level, y) ? skyLumas : cityLumas).push(level);
    }
  }
  skyLumas.sort((a, b) => a - b);
  cityLumas.sort((a, b) => a - b);

  // Ends at the second and ninety-eighth centile rather than at the extremes:
  // a single sun pixel at white would otherwise stretch the whole sky ramp into
  // its top tone and leave everything else in the blue.
  const skyDark = skyLumas[Math.floor(skyLumas.length * 0.02)] ?? 0;
  const skyLight = skyLumas[Math.floor(skyLumas.length * 0.98)] ?? 255;
  const skySpan = Math.max(1, skyLight - skyDark);

  const cityCuts: number[] = [];
  for (let index = 1; index < CITY_TONES.length; index += 1) {
    cityCuts.push(cityLumas[Math.floor((cityLumas.length * index) / CITY_TONES.length)] ?? 0);
  }

  const tones = SKY_TONES.map((role) => swatchRgb(ROLES[role]));
  const city = CITY_TONES.map((role) => swatchRgb(ROLES[role]));
  const lit = swatchRgb(ROLES.cityWindow);

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      if (png.data[i + 3] === 0) continue;
      const [r, g, b] = pixel(x, y);
      const level = luma(r, g, b);
      let chosen: readonly [number, number, number];

      if (isLitPixel(r, g, b)) {
        chosen = lit;
      } else if (isSky(level, y)) {
        // Dither between the two tones either side of this pixel's place on the
        // sky ramp, so a slow gradient stipples instead of banding. Raised to
        // `SKY_RISE` first: the source's own sky is mostly pale, so a directly
        // proportional ramp spends most of the field in the warm middle band and
        // the blue is left as a strip at the very top. Weighting the ramp toward
        // the cool end gives the blue the share of the sky it has in the board.
        const rise = Math.min(1, Math.max(0, (level - skyDark) / skySpan));
        const position = Math.pow(rise, SKY_RISE) * (tones.length - 1);
        const index = Math.min(tones.length - 2, Math.floor(position));
        const fraction = position - index;
        const threshold = BAYER[y % 4]![x % 4]! + 0.5;
        chosen = tones[fraction > threshold ? index + 1 : index]!;
      } else {
        let band = 0;
        while (band < cityCuts.length && level >= cityCuts[band]!) band += 1;
        chosen = city[band]!;
      }

      png.data[i] = chosen[0];
      png.data[i + 1] = chosen[1];
      png.data[i + 2] = chosen[2];
    }
  }
}

/**
 * Removes isolated pixels left by the median split.
 *
 * Where the illustration put a soft gradient across a wall, half of it falls
 * either side of the median and the split scatters single pixels through it --
 * the same single-pixel glitter the brief rejects on windows, arriving by a
 * different route. A pixel whose four neighbours all disagree with it is noise
 * rather than detail, so it joins them. Run to a fixed point would erode real
 * one-pixel features like an antenna; two passes clears the scatter and leaves
 * anything with a neighbour to stand on.
 */
export function despeckle(png: PNG, passes = 2): void {
  const at = (x: number, y: number): string | undefined => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return undefined;
    const i = (y * png.width + x) * 4;
    if (png.data[i + 3] === 0) return undefined;
    return `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
  };

  for (let pass = 0; pass < passes; pass += 1) {
    const edits: [number, number, string][] = [];
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const self = at(x, y);
        if (self === undefined) continue;
        const neighbours = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter(
          (value): value is string => value !== undefined,
        );
        if (neighbours.length < 4) continue;
        if (neighbours.some((value) => value === self)) continue;
        if (!neighbours.every((value) => value === neighbours[0])) continue;
        edits.push([x, y, neighbours[0]!]);
      }
    }
    if (edits.length === 0) return;
    for (const [x, y, value] of edits) {
      const [r, g, b] = value.split(",").map(Number) as [number, number, number];
      const i = (y * png.width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
    }
  }
}

/**
 * Erases lit regions too small to be a window.
 *
 * Downsampling an illustration turns a thin bright fitting -- a handrail catching
 * the sun, the lip of a vent -- into one or two warm pixels, and the warmth test
 * that finds real windows finds those too. Scattered across a facade they are
 * precisely the single-pixel glitter the brief rejects, so anything smaller than
 * a pane is returned to the wall it sits on.
 *
 * The wall it is returned to is whichever of the two body values borders it
 * most, so a speck in shadow does not come back as a lit face.
 */
export function clearSpecks(png: PNG, minimumArea: number, lit: readonly [number, number, number]): void {
  const key = (x: number, y: number): number => y * png.width + x;
  const isLit = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return false;
    const i = key(x, y) * 4;
    return (
      png.data[i + 3] !== 0 &&
      png.data[i] === lit[0] &&
      png.data[i + 1] === lit[1] &&
      png.data[i + 2] === lit[2]
    );
  };

  const seen = new Set<number>();
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (seen.has(key(x, y)) || !isLit(x, y)) continue;

      const region: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      seen.add(key(x, y));
      const border = new Map<string, number>();

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        region.push([cx, cy]);
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as [number, number][]) {
          if (nx < 0 || ny < 0 || nx >= png.width || ny >= png.height) continue;
          if (isLit(nx, ny)) {
            if (seen.has(key(nx, ny))) continue;
            seen.add(key(nx, ny));
            stack.push([nx, ny]);
            continue;
          }
          const i = key(nx, ny) * 4;
          if (png.data[i + 3] === 0) continue;
          const colour = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
          border.set(colour, (border.get(colour) ?? 0) + 1);
        }
      }

      if (region.length >= minimumArea) continue;
      const winner = [...border.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (winner === undefined) continue;
      const [r, g, b] = winner.split(",").map(Number) as [number, number, number];
      for (const [px, py] of region) {
        const i = key(px, py) * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
      }
    }
  }
}

/**
 * A reflected 2x2 morphological open, then close, over every colour at once.
 *
 * The pass that takes the machine's hand off the drawing, and it is worth
 * saying what it actually does because "simplify" undersells it.
 *
 * Each colour is treated as a binary mask. Opening it with a 2x2 element keeps
 * only those pixels that belong to some 2x2 square entirely inside the mask,
 * which deletes every protrusion, spur and speck thinner than two pixels.
 * Closing then fills any notch or pinhole a 2x2 square cannot fit into. What
 * survives is a shape whose smallest feature is two pixels in both directions
 * -- which is the constraint a person working in pixels is under anyway, and
 * precisely the constraint a generator is not.
 *
 * Reflected, meaning the element is not anchored at a corner. A 2x2 open
 * anchored at its top-left shifts every surviving shape half a pixel up and
 * left; testing whether *any* containing square fits is symmetric, so shapes
 * thin out where they are rather than sliding.
 *
 * Alpha is untouched. The silhouette is the one thing the conversion already
 * got right, and eroding it would eat the rooflines rather than the noise on
 * them, so this only ever decides which colour a already-opaque pixel takes.
 */
export function morphSimplify(png: PNG): void {
  const size = png.width * png.height;
  const colours = new Map<string, number>();
  const at = new Array<string | undefined>(size);

  for (let i = 0; i < size; i += 1) {
    const o = i * 4;
    if (png.data[o + 3] === 0) continue;
    const key = `${png.data[o]},${png.data[o + 1]},${png.data[o + 2]}`;
    at[i] = key;
    colours.set(key, (colours.get(key) ?? 0) + 1);
  }

  const index = (x: number, y: number): number => y * png.width + x;
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < png.width && y < png.height;

  /** Whether some 2x2 square containing (x, y) lies entirely in `mask`. */
  const fits = (mask: Uint8Array, x: number, y: number): boolean => {
    for (const [ox, oy] of [
      [0, 0],
      [-1, 0],
      [0, -1],
      [-1, -1],
    ] as const) {
      let all = true;
      for (let dy = 0; dy < 2 && all; dy += 1) {
        for (let dx = 0; dx < 2 && all; dx += 1) {
          const nx = x + ox + dx;
          const ny = y + oy + dy;
          if (!inside(nx, ny) || mask[index(nx, ny)] !== 1) all = false;
        }
      }
      if (all) return true;
    }
    return false;
  };

  // Largest classes first, so where an opened shape has retreated from a pixel
  // the dominant surface around it is what takes the ground back.
  const ranked = [...colours.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  const claims = new Map<string, Uint8Array>();

  for (const colour of ranked) {
    const mask = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) mask[i] = at[i] === colour ? 1 : 0;

    const opened = new Uint8Array(size);
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) opened[index(x, y)] = fits(mask, x, y) ? 1 : 0;
    }

    // Closing is the same test against the complement: a pixel is filled back
    // in unless some empty 2x2 square can contain it.
    const gap = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) gap[i] = opened[i] === 1 ? 0 : 1;

    const closed = new Uint8Array(size);
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) closed[index(x, y)] = fits(gap, x, y) ? 0 : 1;
    }
    claims.set(colour, closed);
  }

  for (let i = 0; i < size; i += 1) {
    const original = at[i];
    if (original === undefined) continue;
    if (claims.get(original)?.[i] === 1) continue;

    const winner = ranked.find((colour) => claims.get(colour)?.[i] === 1);
    if (winner === undefined) continue;
    const [r, g, b] = winner.split(",").map(Number) as [number, number, number];
    const o = i * 4;
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
  }
}

/**
 * Snaps every feature onto a coarser pixel grid.
 *
 * This is the pass that stops the art reading as machine-made, and the reason
 * is worth stating because it is not obvious: what gives a generated image
 * away at this scale is rarely the drawing, it is that the drawing sits off
 * the grid. A person working in pixels picks a resolution and every edge,
 * every window and every aerial lands on it. A generator draws an illustration
 * and the conversion samples it, so features end up at arbitrary offsets and
 * at arbitrary sizes -- including sizes below one of the art's own pixels,
 * which no one working by hand can even express.
 *
 * Each block votes and takes one colour. The effect is the same as having
 * drawn the plate at `width / block` and scaled it up, which is exactly what a
 * pixel artist would have done, and it costs the detail that could not have
 * been drawn deliberately in the first place.
 */
export function coarsen(png: PNG, block: number): void {
  for (let y0 = 0; y0 < png.height; y0 += block) {
    for (let x0 = 0; x0 < png.width; x0 += block) {
      const votes = new Map<string, number>();
      let clear = 0;
      let total = 0;

      for (let y = y0; y < Math.min(y0 + block, png.height); y += 1) {
        for (let x = x0; x < Math.min(x0 + block, png.width); x += 1) {
          const i = (y * png.width + x) * 4;
          total += 1;
          if (png.data[i + 3] === 0) {
            clear += 1;
            continue;
          }
          const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
          votes.set(key, (votes.get(key) ?? 0) + 1);
        }
      }

      // A block more than half empty becomes empty: a silhouette drawn on a
      // grid has no half-covered edge pixels.
      const winner =
        clear * 2 > total
          ? undefined
          : [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

      for (let y = y0; y < Math.min(y0 + block, png.height); y += 1) {
        for (let x = x0; x < Math.min(x0 + block, png.width); x += 1) {
          const i = (y * png.width + x) * 4;
          if (winner === undefined) {
            png.data[i + 3] = 0;
            continue;
          }
          const [r, g, b] = winner.split(",").map(Number) as [number, number, number];
          png.data[i] = r;
          png.data[i + 1] = g;
          png.data[i + 2] = b;
          png.data[i + 3] = 255;
        }
      }
    }
  }
}

/**
 * Absorbs any shape too small to have been drawn on purpose.
 *
 * `clearSpecks` does this for lit windows alone, where the question is whether
 * a warm pixel is a pane. This asks the more general question of every colour
 * at once: a person drawing a wall does not put a three-pixel patch of shadow
 * in the middle of it, so a region that small is a sampling artefact whatever
 * colour it happens to be. Each one joins whichever neighbour surrounds it
 * most.
 *
 * Measured in blocks rather than pixels, so it means the same thing after
 * `coarsen` as before it.
 */
export function openShapes(png: PNG, minArea: number): void {
  const at = (x: number, y: number): string | undefined => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return undefined;
    const i = (y * png.width + x) * 4;
    if (png.data[i + 3] === 0) return undefined;
    return `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
  };

  const seen = new Set<number>();
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const key = y * png.width + x;
      const self = at(x, y);
      if (seen.has(key) || self === undefined) continue;

      const region: number[] = [];
      const stack: [number, number][] = [[x, y]];
      const border = new Map<string, number>();
      seen.add(key);

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        region.push(cy * png.width + cx);
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as [number, number][]) {
          const neighbour = at(nx, ny);
          if (neighbour === undefined) continue;
          if (neighbour === self) {
            const nk = ny * png.width + nx;
            if (seen.has(nk)) continue;
            seen.add(nk);
            stack.push([nx, ny]);
            continue;
          }
          border.set(neighbour, (border.get(neighbour) ?? 0) + 1);
        }
      }

      if (region.length >= minArea) continue;
      const winner = [...border.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (winner === undefined) continue;
      const [r, g, b] = winner.split(",").map(Number) as [number, number, number];
      for (const index of region) {
        const i = index * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
      }
    }
  }
}

/** Clears detached opaque flecks without thinning any connected silhouette. */
export function clearAlphaIslands(png: PNG, minArea: number, requireBottomConnection = false): void {
  const key = (x: number, y: number): number => y * png.width + x;
  const opaque = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return false;
    return png.data[key(x, y) * 4 + 3] !== 0;
  };
  const seen = new Set<number>();

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const start = key(x, y);
      if (seen.has(start) || !opaque(x, y)) continue;
      const region: number[] = [];
      let lowest = y;
      const stack: [number, number][] = [[x, y]];
      seen.add(start);
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        region.push(key(cx, cy));
        lowest = Math.max(lowest, cy);
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
          const next = key(nx, ny);
          if (!opaque(nx, ny) || seen.has(next)) continue;
          seen.add(next);
          stack.push([nx, ny]);
        }
      }
      if (region.length >= minArea && (!requireBottomConnection || lowest >= png.height - 4)) continue;
      for (const pixel of region) png.data[pixel * 4 + 3] = 0;
    }
  }
}

