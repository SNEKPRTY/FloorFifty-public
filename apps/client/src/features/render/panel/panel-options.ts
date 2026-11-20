/**
 * The panel's numbers, and nothing that touches a GPU.
 *
 * Two jobs live here rather than in the shader or the filter. The pitch
 * derivation is one of them because every number it produces depends only on
 * the viewport and the tuning, so computing them on the CPU gives them a single
 * home that a unit test can reach without a renderer -- and keeps the shader
 * from carrying a second, silently divergent copy of the same maths. The mesh's
 * `ceil`, its frequency and its Nyquist fade are all constant across a frame,
 * so all three are derived here and handed over as uniforms.
 */

import { LCD_PANEL } from "../../../lib/constants";

/**
 * The panel's tuning, widened.
 *
 * Spelled out rather than mapped off `typeof LCD_PANEL`. That constant is
 * `as const`, so a mapped type would inherit its *literal* types -- `grid`
 * would be `0.3`, not `number` -- and the override below could not assign to
 * it.
 */
export type PanelOptions = {
  enabled: boolean;
  grid: number;
  balance: number;
  minPitch: number;
  subpixels: number;
  layout: number;
  scanlines: number;
  aberration: number;
  glow: number;
  glowThreshold: number;
  glowRadius: number;
  brightness: number;
  gamma: number;
};

/** The mesh's geometry for one viewport. */
export type Pitch = {
  /** Whole logical units per period. The shader's `uCells`. */
  cells: number;
  /** One period, in CSS pixels. Never shorter than `minPitch`. */
  periodCssPx: number;
  /** One period, in device pixels. `periodCssPx` scaled by the device ratio. */
  periodDevicePx: number;
  /** Cycles per output pixel. The shader's `uCyclesPerPixel`. */
  cyclesPerPixel: number;
  /** The Nyquist fade, in `[0, 1]`. The shader's `uFade`. 0 removes the mesh. */
  fade: number;
};

/** GLSL's `smoothstep`, because the fade this returns is what the shader uses. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Derives the mesh's geometry for a viewport.
 *
 * Two different pixels meet here and confusing them is the whole reason this
 * function takes three arguments rather than two:
 *
 * - `cellSize` is **CSS pixels** per logical unit -- `LetterboxGeometry.scale`,
 *   which divides `renderer.width`, and `renderer.width` is the canvas in CSS
 *   pixels rather than in device pixels. It sets how big the mesh *looks*.
 * - `pixelRatio` is **device pixels** per CSS pixel -- `renderer.resolution`.
 *   The fragment program runs once per device pixel, so it sets what the mesh
 *   can be *resolved* at.
 *
 * `minPitch` is in CSS pixels, so the mesh keeps the same apparent size on a
 * dense display instead of shrinking to a quarter of it.
 *
 * The period is a WHOLE number of logical units, never a fixed pixel size, so
 * the pattern stays periodic on the game's own grid. The `1e-4` bias is
 * upstream's and is load-bearing: a ratio of exactly 1 can land a hair above
 * itself in floating point and take the ceiling to 2.
 */
export function derivePitch(cellSize: number, minPitch: number, pixelRatio: number): Pitch {
  const cells = Math.max(Math.ceil(minPitch / cellSize - 1e-4), 1);
  const periodCssPx = cells * cellSize;
  const periodDevicePx = periodCssPx * pixelRatio;
  const cyclesPerPixel = 1 / periodDevicePx;

  // Past Nyquist the pattern would fold to a coarser pitch at nearly full
  // strength, so it is taken out entirely instead. This engages on `minPitch`,
  // never on device density: `cells` adapts, so at `pixelRatio` 1 the period is
  // always at least `minPitch` pixels, and a denser display only ever makes the
  // same pattern easier to resolve.
  const fade = 1 - smoothstep(0.34, 0.5, cyclesPerPixel);

  return { cells, periodCssPx, periodDevicePx, cyclesPerPixel, fade };
}

/** Keys the dev override accepts: every tunable, but not `enabled`. */
const TUNABLE = [
  "grid",
  "balance",
  "minPitch",
  "subpixels",
  "layout",
  "scanlines",
  "aberration",
  "glow",
  "glowThreshold",
  "glowRadius",
  "brightness",
  "gamma",
] as const;

type Tunable = (typeof TUNABLE)[number];

function isTunable(key: string): key is Tunable {
  return (TUNABLE as readonly string[]).includes(key);
}

/**
 * Applies a `?lcd=grid:0.5,scanlines:0.35` override to the defaults.
 *
 * A shader is tuned by eye, and an edit-and-reload cycle per quarter-point is
 * how a look ends up half-tuned. `panelOptionsFor` below is the gate that keeps
 * this unreachable outside a dev build; nothing calls it directly.
 *
 * Anything unrecognised is dropped rather than propagated: a `NaN` here would
 * reach a uniform and take the whole frame with it.
 */
export function resolvePanelOptions(
  search: string,
  base: PanelOptions = { ...LCD_PANEL },
): PanelOptions {
  const resolved: PanelOptions = { ...base };
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("lcd");
  if (raw === null || raw.trim() === "") return resolved;

  for (const segment of raw.split(",")) {
    if (segment.trim() === "") continue;
    const [key, value] = segment.split(":");
    if (key === undefined || value === undefined) continue;

    const name = key.trim();
    if (!isTunable(name)) continue;

    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) continue;

    resolved[name] = parsed;
  }

  return resolved;
}

/**
 * The options a build should actually run with.
 *
 * The dev gate lives here, rather than as a ternary at the call site, so both
 * of its branches are reachable from a unit test. Shipping the override reader
 * to production is the failure this module is most able to cause and the least
 * likely to notice, and a gate nothing exercises is not a gate.
 *
 * The cost is that `resolvePanelOptions` is no longer statically eliminated
 * from a production bundle -- a constant-folded `import.meta.env.DEV` at the
 * call site used to shake it out. It is a few hundred bytes of parser that can
 * never be reached, which is the cheaper half of the trade.
 */
export function panelOptionsFor(search: string, dev: boolean): PanelOptions {
  if (!dev) return { ...LCD_PANEL };
  return resolvePanelOptions(search);
}

/**
 * Whether an inspection build was asked to draw gameplay without the panel.
 *
 * `?lcd=off`, behind the same gate as the other inspection overrides, so a
 * production build can never reach it. It exists for pixel measurements of
 * what is *under* the panel -- the crisp city, a skyline's edge -- which the
 * panel's aberration and halation would otherwise smear by design.
 */
export function panelSuppressedFor(search: string, allowInspectionOverride: boolean): boolean {
  if (!allowInspectionOverride) return false;
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("lcd");
  return raw === "off";
}
