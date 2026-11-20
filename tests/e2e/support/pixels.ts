/**
 * Reading what the renderer actually put on screen.
 *
 * The spec asks the end-to-end suite to fail on a blank canvas. Checking that a
 * `<canvas>` element exists with a non-zero width does not do that: a renderer
 * that dies after clearing leaves a perfectly sized canvas full of one colour,
 * and every screenshot taken of it is a picture of a failed render.
 *
 * WebGL discards its drawing buffer after compositing unless the context asked
 * to keep it, so reading the pixels back out of the canvas inside the page is
 * unreliable and would mean turning on `preserveDrawingBuffer` in production
 * for the sake of a test. A screenshot of the composited page has none of those
 * problems, and it measures the thing that actually matters: what a player
 * would see.
 */

import { PNG } from "pngjs";

/** What a frame is made of, as far as "did anything draw" is concerned. */
export type Coverage = {
  width: number;
  height: number;
  /** How many distinct opaque colours appear. */
  distinctColours: number;
  /** Share of pixels that are not the single most common colour, in `[0, 1]`. */
  paintedShare: number;
};

/**
 * Fewer colours than this is a cleared buffer with some antialiasing on it.
 *
 * A real frame of this game carries a sky gradient alone in the hundreds.
 */
const MIN_DISTINCT_COLOURS = 8;

/**
 * How much of the frame must differ from its most common colour.
 *
 * Deliberately small: the course is sparse, so most of a legitimate frame is
 * sky. It only has to be more than the stray pixels an empty frame collects.
 */
const MIN_PAINTED_SHARE = 0.01;

/** Measures a PNG screenshot. */
export function measureCoverage(screenshot: Buffer | Uint8Array): Coverage {
  const png = PNG.sync.read(Buffer.from(screenshot));
  const counts = new Map<number, number>();

  for (let index = 0; index < png.data.length; index += 4) {
    // Alpha is ignored: a screenshot is composited, so everything is opaque and
    // the question is only which colours are present.
    const colour =
      ((png.data[index] ?? 0) << 16) | ((png.data[index + 1] ?? 0) << 8) | (png.data[index + 2] ?? 0);
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }

  const total = png.width * png.height;

  // Folded rather than spread. `Math.max(0, ...counts.values())` passes one
  // argument per distinct colour, and a frame drawn through the LCD panel
  // carries well over sixty thousand of them -- past the engine's argument
  // limit, where the spread throws `RangeError: Maximum call stack size
  // exceeded` rather than returning a wrong answer.
  let modal = 0;
  for (const count of counts.values()) if (count > modal) modal = count;

  return {
    width: png.width,
    height: png.height,
    distinctColours: counts.size,
    paintedShare: total === 0 ? 0 : (total - modal) / total,
  };
}

/**
 * Whether a screenshot shows a frame that never drew.
 *
 * Both conditions have to hold. A cleared buffer is one colour covering
 * everything, so it fails both; requiring only one of them would call a
 * legitimately flat frame blank, and a false failure here is worse than a
 * narrow check, because the thing being guarded against is a frame with
 * nothing in it at all.
 */
export function isBlank(screenshot: Buffer | Uint8Array): boolean {
  const coverage = measureCoverage(screenshot);
  return (
    coverage.distinctColours < MIN_DISTINCT_COLOURS &&
    coverage.paintedShare < MIN_PAINTED_SHARE
  );
}

/** A one-line account of a frame, so a failure says what it saw. */
export function describeCoverage(screenshot: Buffer | Uint8Array): string {
  const coverage = measureCoverage(screenshot);
  return (
    `${coverage.width}x${coverage.height}, ` +
    `${coverage.distinctColours} distinct colour${coverage.distinctColours === 1 ? "" : "s"}, ` +
    `${(coverage.paintedShare * 100).toFixed(1)}% of pixels off the background`
  );
}

/** Share of composited pixels whose brightest channel clears `threshold`. */
export function visiblePixelShare(
  screenshot: Buffer | Uint8Array,
  threshold = 32,
): number {
  const png = PNG.sync.read(Buffer.from(screenshot));
  let visible = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    if (Math.max(png.data[index] ?? 0, png.data[index + 1] ?? 0, png.data[index + 2] ?? 0) > threshold) {
      visible += 1;
    }
  }
  return visible / (png.width * png.height);
}

/** Which lines a refraction probe drew: `vertical` lines move in x. */
export type ProbeAxis = "vertical" | "horizontal";

export type ProbeShiftOptions = {
  /** Logical units across the screenshot's width; the field is fitted to it. */
  logicalWidth?: number;
  /** Line spacing in logical units; lines sit at `pitch / 2 + pitch * k`. */
  pitch?: number;
  /** The field's top edge in screenshot pixels (the letterbox `y`). */
  originY?: number;
  /** The logical rows (or columns) to sample along each line, inclusive. */
  along: [number, number];
  /** How far apart samples along a line are, in logical units. */
  step?: number;
  /** Only lines drawn inside this logical range are measured, e.g. clear of the bars. */
  across?: [number, number];
};

/**
 * The largest displacement of any probe line from where it was drawn, in
 * logical units.
 *
 * Each line is sampled across its own cell only (half a pitch either side of
 * where it was drawn), so a neighbour can never pull its centroid. The
 * centroid is luma-weighted above the cell's darkest pixel, which makes it
 * indifferent to how the refraction's diffusion spread the line, as long as
 * the spread is symmetric -- which its tap pattern is.
 */
export function maxProbeLineShift(
  screenshot: Buffer | Uint8Array,
  axis: ProbeAxis,
  options: ProbeShiftOptions,
): number {
  const png = PNG.sync.read(Buffer.from(screenshot));
  const logicalWidth = options.logicalWidth ?? 960;
  const pitch = options.pitch ?? 32;
  const originY = options.originY ?? 0;
  const step = options.step ?? 4;
  const scale = png.width / logicalWidth;
  const luma = (px: number, py: number): number => {
    const index = (Math.floor(py) * png.width + Math.floor(px)) * 4;
    return (
      0.2126 * (png.data[index] ?? 0) +
      0.7152 * (png.data[index + 1] ?? 0) +
      0.0722 * (png.data[index + 2] ?? 0)
    );
  };
  // Screenshot pixel for a logical coordinate on each axis.
  const toX = (logical: number): number => logical * scale;
  const toY = (logical: number): number => originY + logical * scale;
  // `across` is the axis the line moves in; `along` is the one it runs down.
  const acrossExtent = axis === "vertical" ? logicalWidth : (png.height - originY) / scale;
  const sample = (across: number, along: number): number =>
    axis === "vertical" ? luma(toX(across), toY(along)) : luma(toX(along), toY(across));
  const pixelsPerUnit = scale;

  let largest = 0;
  // The outermost lines are skipped: a warp near the frame's edge samples its
  // clamp, which is a different question from how far the warp reaches.
  for (let drawn = pitch * 1.5; drawn <= acrossExtent - pitch * 1.5; drawn += pitch) {
    if (options.across !== undefined) {
      if (drawn - pitch / 2 < options.across[0] || drawn + pitch / 2 > options.across[1]) continue;
    }
    const centre = drawn + 0.5;
    for (let along = options.along[0]; along <= options.along[1]; along += step) {
      const start = Math.ceil((centre - pitch / 2) * pixelsPerUnit);
      const end = Math.floor((centre + pitch / 2) * pixelsPerUnit);
      const values: { at: number; value: number }[] = [];
      for (let px = start; px < end; px += 1) {
        const at = (px + 0.5) / pixelsPerUnit;
        values.push({ at, value: sample(at, along) });
      }
      const floor = Math.min(...values.map((entry) => entry.value));
      let weight = 0;
      let moment = 0;
      for (const entry of values) {
        const lifted = entry.value - floor;
        weight += lifted;
        moment += lifted * entry.at;
      }
      // A cell with nothing lit in it has no line to measure.
      if (weight < 64) continue;
      largest = Math.max(largest, Math.abs(moment / weight - centre));
    }
  }
  return largest;
}

export type EdgeSharpness = {
  /** Vertical luma edges found (one per column crossing), of at least `minChange`. */
  edges: number;
  /** How many of them happen in a single pixel step. */
  crisp: number;
};

/**
 * How many of the horizontal edges in a region are single-pixel steps.
 *
 * Walks each column top to bottom. An edge is the largest per-pixel luma step
 * in a window of `span` pixels whose total change is at least `minChange`; it
 * is crisp when that one step carries at least `crispShare` of the change.
 * A nearest-sampled skyline at integer scale is one step; a linearly upscaled
 * or blurred one spreads the same change over several pixels.
 */
export function edgeSharpness(
  screenshot: Buffer | Uint8Array,
  region: { x: number; y: number; width: number; height: number },
  options: {
    minChange?: number;
    span?: number;
    crispShare?: number;
    /**
     * Count only edges with one of these colours on one side, as `#rrggbb`.
     * A frame holds more than one layer; this is how a measurement of the
     * skyline stays about the skyline.
     */
    involving?: readonly string[];
    /** Skip any edge with one of these colours on either side, as `#rrggbb`. */
    excluding?: readonly string[];
    /** Count only edges with one of these colours on *both* sides. */
    within?: readonly string[];
  } = {},
): EdgeSharpness {
  const png = PNG.sync.read(Buffer.from(screenshot));
  const minChange = options.minChange ?? 48;
  const span = options.span ?? 6;
  const crispShare = options.crispShare ?? 0.8;
  const half = Math.floor(span / 2);
  const involving = options.involving?.map((colour) => colour.toLowerCase());
  const excluding = options.excluding?.map((colour) => colour.toLowerCase()) ?? [];
  const within = options.within?.map((colour) => colour.toLowerCase());
  const hexAt = (x: number, y: number): string => {
    const index = (y * png.width + x) * 4;
    return `#${[0, 1, 2].map((offset) => (png.data[index + offset] ?? 0).toString(16).padStart(2, "0")).join("")}`;
  };
  const luma = (x: number, y: number): number => {
    const index = (y * png.width + x) * 4;
    return (
      0.2126 * (png.data[index] ?? 0) +
      0.7152 * (png.data[index + 1] ?? 0) +
      0.0722 * (png.data[index + 2] ?? 0)
    );
  };

  let edges = 0;
  let crisp = 0;
  const top = Math.max(0, Math.floor(region.y));
  const bottom = Math.min(png.height, Math.floor(region.y + region.height));
  for (let x = Math.max(0, Math.floor(region.x)); x < Math.min(png.width, region.x + region.width); x += 1) {
    const column: number[] = [];
    for (let y = top; y < bottom; y += 1) column.push(luma(x, y));
    const step = (y: number): number => Math.abs((column[y + 1] ?? 0) - (column[y] ?? 0));
    for (let y = half; y < column.length - half - 1; y += 1) {
      // Anchored on the window's largest step, so an edge is judged by its
      // dominant step rather than by a small wobble just before it.
      let largest = 0;
      for (let at = y - half; at <= y + half; at += 1) largest = Math.max(largest, step(at));
      if (step(y) !== largest) continue;
      const change = Math.abs((column[y + half + 1] ?? 0) - (column[y - half] ?? 0));
      if (change < minChange) continue;
      const above = hexAt(x, top + y - half);
      const below = hexAt(x, top + y + half + 1);
      if (involving !== undefined && !involving.includes(above) && !involving.includes(below)) continue;
      if (excluding.includes(above) || excluding.includes(below)) continue;
      if (within !== undefined && !(within.includes(above) && within.includes(below))) continue;
      edges += 1;
      if (largest >= crispShare * change) crisp += 1;
      // The rest of this edge's span is the same edge; a ramp whose rounded
      // steps are uneven would otherwise count twice.
      y += span;
    }
  }
  return { edges, crisp };
}
