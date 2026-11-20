/**
 * The gameplay LCD panel.
 *
 * Its own module rather than a few lines in the screen, for the same reason
 * `bloom.ts` is: the one behaviour worth pinning is the failure path. A
 * renderer that cannot compile the program must still draw the game, and
 * testing that through a mounted screen would mean loading asset bundles and
 * opening a socket to assert one array is empty.
 */

import { Filter, GlProgram, defaultFilterVert } from "pixi.js";
import type { Container } from "pixi.js";
import { LCD_PANEL } from "../../../lib/constants";
import { derivePitch, type PanelOptions } from "./panel-options";
import { PANEL_FRAGMENT } from "./panel-shader";

/**
 * The filtered layer, and nothing else.
 *
 * Narrower than both `StagePort` and `LetterboxFrame` so it accepts either: the
 * screen passes the port, the test passes the frame.
 */
export type PanelTarget = { scene: Container };

type PanelUniforms = {
  uCellSize: number;
  uCells: number;
  uCyclesPerPixel: number;
  uFade: number;
  uGrid: number;
  uBalance: number;
  uSubpixels: number;
  uLayout: number;
  uScanlines: number;
  uAberration: number;
  uGlow: number;
  uGlowThreshold: number;
  uGlowRadius: number;
  uBrightness: number;
  uGamma: number;
};

type PanelFilter = Filter & {
  resources: { lcdUniforms: { uniforms: PanelUniforms } };
  /** Kept so a resize can re-derive the pitch without the caller holding it. */
  lcdOptions: PanelOptions;
};

function isPanelFilter(filter: unknown): filter is PanelFilter {
  return filter instanceof Filter && "lcdOptions" in filter;
}

function createPanelFilter(options: PanelOptions): PanelFilter {
  const filter = new Filter({
    glProgram: new GlProgram({ vertex: defaultFilterVert, fragment: PANEL_FRAGMENT }),
    // Not a tuning knob, and not optional. Pixi's default is a flat 1, which
    // renders the whole filtered subtree into a texture at one texel per CSS
    // pixel -- so on any display with a device ratio above 1 the pass would
    // hand back a HALVED scene, HUD text included, and upscale it to the
    // canvas. That is precisely the outcome the spec rejected a `RenderTexture`
    // to avoid, and it arrives silently through a default rather than through
    // anything written here.
    resolution: "inherit",
    resources: {
      lcdUniforms: {
        // The geometry uniforms are placeholders until the first `resizePanel`,
        // which `createStage.layout()` always runs.
        uCellSize: { value: 1, type: "f32" },
        uCells: { value: 1, type: "f32" },
        uCyclesPerPixel: { value: 0, type: "f32" },
        uFade: { value: 0, type: "f32" },
        uGrid: { value: options.grid, type: "f32" },
        uBalance: { value: options.balance, type: "f32" },
        uSubpixels: { value: options.subpixels, type: "f32" },
        uLayout: { value: options.layout, type: "f32" },
        uScanlines: { value: options.scanlines, type: "f32" },
        uAberration: { value: options.aberration, type: "f32" },
        uGlow: { value: options.glow, type: "f32" },
        uGlowThreshold: { value: options.glowThreshold, type: "f32" },
        uGlowRadius: { value: options.glowRadius, type: "f32" },
        uBrightness: { value: options.brightness, type: "f32" },
        uGamma: { value: options.gamma, type: "f32" },
      },
    },
  }) as PanelFilter;

  filter.lcdOptions = options;
  return filter;
}

/**
 * Releases a panel already hanging off the scene.
 *
 * `destroy(false)`, deliberately: `GlProgram` is keyed on its own source, so
 * every panel this module builds shares one compiled program for the life of
 * the renderer. Destroying programs here would pull that shared entry out from
 * under the replacement built moments earlier. What is worth releasing is the
 * filter's own uniform buffers, and that is what the false destroys.
 */
function releasePanel(stage: PanelTarget): void {
  const existing = (stage.scene.filters ?? [])[0];
  if (isPanelFilter(existing)) existing.destroy(false);
  stage.scene.filters = [];
}

/** Applies the panel to the scene, or removes it. */
export function applyPanel(
  stage: PanelTarget,
  enabled: boolean,
  options: PanelOptions = { ...LCD_PANEL },
): void {
  releasePanel(stage);
  if (!enabled) return;

  try {
    stage.scene.filters = [createPanelFilter(options)];
  } catch {
    // A renderer that cannot build the filter still draws the game.
    stage.scene.filters = [];
  }
}

/**
 * The juice's aberration pulse (A/V polish plan, G6): `extra` on top of the
 * panel's own, for the moment a slam or the finish lands. Zero puts it back.
 * Read off the scene like `resizePanel`, so with the panel off there is
 * nothing to pulse and nothing happens. The padding is left as sized: a pulse
 * lasts a few frames, and a texture reallocated for it would cost more than
 * the sliver it clips at the frame's edge.
 */
export function pulsePanelAberration(stage: PanelTarget, extra: number): void {
  const filter = (stage.scene.filters ?? [])[0];
  if (!isPanelFilter(filter)) return;
  filter.resources.lcdUniforms.uniforms.uAberration = filter.lcdOptions.aberration + Math.max(0, extra);
}

/**
 * Re-derives the pitch and the padding for a new viewport.
 *
 * `cellSize` is CSS pixels per logical unit -- `LetterboxGeometry.scale` --
 * and `pixelRatio` is device pixels per CSS pixel, which is the renderer's
 * resolution. Both are needed and they are not interchangeable: the first is
 * how big the mesh looks, the second is what it can be resolved at.
 *
 * The filter is read back off the scene rather than held here, so this module
 * keeps no state and `LetterboxFrame` needs no knowledge of the panel.
 *
 * A no-op when nothing is filtered: the panel suppressed, or a renderer that
 * took the degrade path. Layout still runs in both cases.
 */
export function resizePanel(stage: PanelTarget, cellSize: number, pixelRatio: number): void {
  const filter = (stage.scene.filters ?? [])[0];
  if (!isPanelFilter(filter)) return;

  const options = filter.lcdOptions;
  const { cells, cyclesPerPixel, fade } = derivePitch(cellSize, options.minPitch, pixelRatio);

  const uniforms = filter.resources.lcdUniforms.uniforms;
  uniforms.uCellSize = cellSize;
  uniforms.uCells = cells;
  uniforms.uCyclesPerPixel = cyclesPerPixel;
  uniforms.uFade = fade;

  // The aberration reaches sideways and the halation reaches diagonally; the
  // pass is padded by whichever is wider, or both clip at the frame edge.
  // Padding is measured in the same CSS pixels the filter's bounds are.
  filter.padding = Math.ceil(Math.max(options.aberration, options.glowRadius) * cellSize);
}
