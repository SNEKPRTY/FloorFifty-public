/**
 * Survival's lava, drawn (lava spec §5).
 *
 * The lava is the local racer's edge made visible: its surface is the edge,
 * and a racer wholly under it is out, exactly as the rule says. It is
 * presentation only and never touches a simulated coordinate.
 *
 * `root` lives in the world, between the racers' bodies and their name tags,
 * so a body sinks into it and a rival's tag still reads over it (spec L4).
 * `marker` is screen space: the view parents it outside the camera, as it
 * does the beat stamps. Every number a test can check without a renderer is
 * in `lava-model.ts`.
 */

import { Container, Graphics, GraphicsContext, Text } from "pixi.js";
import { swatchRgb } from "@floor-fifty/asset-contract/swatches";
import type { ResolvedTuning } from "@floor-fifty/shared/common/tuning";
import { FONT_UI } from "../i18n/fonts";
import { isSinking, lavaHeat, lavaMarkerFloors, lavaSurging } from "./lava-model";

/** A Resurrect 64 swatch as the 24-bit tint Pixi expects. */
const swatch = (index: number): number => {
  const [r, g, b] = swatchRgb(index);
  return (r << 16) | (g << 8) | b;
};

/**
 * The lava's colours: the palette's hot end, which the Aquarian stage keeps
 * for heat (the pending floor's orange-red, the hottest windows' gold). Deep
 * magenta below, coral near the top, a pale gold crest.
 */
const LAVA = {
  deep: swatch(58),
  top: swatch(60),
  glow: swatch(61),
  crest: swatch(23),
  ember: swatch(18),
  steam: swatch(63),
  markerStroke: swatch(0),
} as const;

/** How opaque the fill is: enough to hide a body's detail, not its silhouette (spec L4). */
export const LAVA_FILL_ALPHA = 0.82;
/** The marker's type size, in the layer's units, before it is scaled to stay legible. */
export const LAVA_MARKER_FONT = 14;
/** The most embers alive at once. */
export const MAX_EMBERS = 24;
/** The most steam puffs alive at once. */
const MAX_STEAM = 8;
/** The coral band under the crest, in logical units. */
const TOP_BAND = 18;
/** How far the glow reaches above the surface, in logical units. */
const GLOW_HEIGHT = 40;
const GLOW_STEPS = [0.18, 0.12, 0.07, 0.03] as const;
/** How far below the view's bottom the fill runs, so a shake never shows its edge. */
const FILL_DEPTH = 200;
/** Logical units between the crest's samples. */
const CREST_STEP = 16;
/** Embers a second at full heat. */
const EMBER_RATE = 20;
/** Embers a surge throws the frame it starts. */
const SURGE_BURST = 6;
/** Embers a splash throws. */
const SPLASH_BURST = 10;
/** A steam puff every this many ms while the racer sinks. */
const STEAM_EVERY_MS = 80;

/** The golden ratio's fraction: an even, repeatable spread with no random source (as `dust-pool.ts`). */
const GOLDEN = 0.618_033_988_75;

/**
 * The canvas outside what a player can see of the field, in the effects layer's
 * units (field units, y down), and where the surface falls there. The spill
 * fills it below the surface, so the lava reaches the screen's edges on a
 * phone or tablet instead of stopping at the play field's.
 */
export type LavaSpillFrame = {
  /** The surface's field y this frame, or undefined when the lava is hidden. */
  readonly surface: number | undefined;
  /** What a player can see of the field (`Camera.visibleTop`, `visibleBottom`). */
  readonly visibleTop: number;
  readonly visibleBottom: number;
  /** The canvas, top to bottom. */
  readonly canvasTop: number;
  readonly canvasBottom: number;
  /** The canvas's sides, with room for the shake. */
  readonly left: number;
  readonly right: number;
};

/** The bands the spill fills, top to bottom; empty when the surface is below the canvas or there is no lava. */
export function lavaSpillBands(frame: LavaSpillFrame): { top: number; bottom: number }[] {
  const { surface } = frame;
  if (surface === undefined) return [];
  const bands: { top: number; bottom: number }[] = [];
  // Over the field: only once the lava has risen past the top of the view.
  const above = { top: Math.max(surface, frame.canvasTop), bottom: frame.visibleTop };
  if (above.bottom > above.top) bands.push(above);
  // Under it: from the surface, or the view's foot if the surface is in view.
  const below = { top: Math.max(surface, frame.visibleBottom), bottom: frame.canvasBottom };
  if (below.bottom > below.top) bands.push(below);
  return bands;
}

/** What the view tells the lava each frame. */
export type LavaFrame = {
  /** The local racer's edge, predicted where there is a prediction; undefined hides the lava. */
  readonly edgeY: number | undefined;
  /** The local racer while they are standing; undefined (out, or none) hides the marker and the steam. */
  readonly racer: { readonly x: number; readonly y: number } | undefined;
  /** The local racer's banded rise, units/s (`edgeRiseSpeed`): the heat and the surge read it. */
  readonly rise: number;
  readonly deltaMs: number;
  readonly reducedMotion: boolean;
  /** The view's sides, in logical x. */
  readonly viewLeft: number;
  readonly viewRight: number;
  /** The logical y at the bottom of what a player can see. */
  readonly viewBottomY: number;
  /** Where the marker sits, in the screen-space layer's units. */
  readonly markerAt: { readonly x: number; readonly y: number };
};

type Particle = {
  readonly g: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  live: boolean;
};

export class LavaView {
  /** In the world, between the bodies and the tags. */
  readonly root = new Container({ label: "lava" });
  /** Screen space: the `▼ n` shown while the surface is below the view. */
  readonly marker = new Container({ label: "lava-marker" });
  /**
   * The lava past the play field: flat bands behind the bars and across the canvas
   * beyond the field, in the frame's effects layer, so it fills the screen to
   * its edges (`lavaSpillBands`). The view parents it.
   */
  readonly spill = new Graphics({ label: "lava-spill" });

  private readonly glow = new Graphics();
  private readonly fill = new Graphics();
  private readonly crest = new Graphics();
  private readonly embers: Particle[] = [];
  private readonly steam: Particle[] = [];
  private readonly emberContext = new GraphicsContext().rect(-1, -1, 2, 2).fill(LAVA.ember);
  private readonly steamContext = new GraphicsContext().circle(0, 0, 5).fill(LAVA.steam);
  private readonly markerText: Text;

  private seconds = 0;
  private previousEdgeY: number | undefined;
  private wasSurging = false;
  private emberCarry = 0;
  private spread = 0;
  private steamWaitMs = 0;
  private reduced = false;
  private surface: number | undefined;
  private floors: number | undefined;
  private lastHeat = 0;

  constructor(private readonly tuning: ResolvedTuning) {
    const emberLayer = new Container({ label: "lava-embers" });
    const steamLayer = new Container({ label: "lava-steam" });
    for (let i = 0; i < MAX_EMBERS; i += 1) this.embers.push(this.particle(emberLayer, this.emberContext));
    for (let i = 0; i < MAX_STEAM; i += 1) this.steam.push(this.particle(steamLayer, this.steamContext));
    this.root.addChild(this.glow, this.fill, this.crest, emberLayer, steamLayer);
    this.root.visible = false;

    const chevron = new Graphics().poly([-14, -5, -4, -5, -9, 3]).fill(LAVA.crest).stroke({ width: 1.5, color: LAVA.markerStroke });
    this.markerText = new Text({
      text: "",
      style: { fontFamily: FONT_UI, fontSize: LAVA_MARKER_FONT, fontWeight: "600", fill: LAVA.crest, stroke: { color: LAVA.markerStroke, width: 3 } },
    });
    this.markerText.anchor.set(0, 0.5);
    this.markerText.x = 0;
    this.marker.addChild(chevron, this.markerText);
    this.marker.visible = false;
  }

  /** The surface's logical y as last drawn; undefined while hidden. */
  get surfaceY(): number | undefined {
    return this.surface;
  }

  /** The marker's floor count; undefined while it is hidden. */
  get markerFloors(): number | undefined {
    return this.floors;
  }

  /** How hot the lava ran last frame, 0 to 1. */
  get heat(): number {
    return this.lastHeat;
  }

  /** Embers in flight, for tests and inspection. */
  get embersLive(): number {
    return this.embers.filter((ember) => ember.live).length;
  }

  update(frame: LavaFrame): void {
    const { edgeY } = frame;
    this.reduced = frame.reducedMotion;
    this.surface = edgeY;
    if (edgeY === undefined) {
      this.root.visible = false;
      this.marker.visible = false;
      this.floors = undefined;
      this.previousEdgeY = undefined;
      return;
    }
    this.root.visible = true;
    const deltaSeconds = Math.max(0, frame.deltaMs) / 1000;
    if (!frame.reducedMotion) this.seconds += deltaSeconds;

    const heat = lavaHeat(frame.rise, this.tuning);
    this.lastHeat = heat;
    const surging =
      this.previousEdgeY !== undefined && lavaSurging(edgeY, this.previousEdgeY, frame.rise, deltaSeconds);
    const surgeStarts = surging && !this.wasSurging;
    this.previousEdgeY = edgeY;
    this.wasSurging = surging;

    this.draw(edgeY, heat, surging, frame);
    this.advanceParticles(frame.deltaMs);

    if (!frame.reducedMotion) {
      this.emberCarry += heat * EMBER_RATE * deltaSeconds;
      let count = Math.floor(this.emberCarry);
      this.emberCarry -= count;
      if (surgeStarts) count += SURGE_BURST;
      for (let i = 0; i < count; i += 1) this.throwEmber(this.across(frame), edgeY, 30, 60);
      this.steamFor(frame, edgeY);
    }

    this.floors = frame.racer === undefined ? undefined : lavaMarkerFloors(frame.racer.y, edgeY, frame.viewBottomY, this.tuning);
    this.marker.visible = this.floors !== undefined;
    if (this.floors !== undefined) {
      this.markerText.text = String(this.floors);
      this.marker.position.set(frame.markerAt.x, frame.markerAt.y);
    }
  }

  /** Embers thrown up where the local racer went under (spec §5). None under reduced motion. */
  splash(x: number): void {
    if (this.reduced || this.surface === undefined) return;
    for (let i = 0; i < SPLASH_BURST; i += 1) this.throwEmber(x + (this.nextSpread() - 0.5) * 24, this.surface, 80, 140);
  }

  /** Redraws the spill for this frame (see `spill`). */
  updateSpill(frame: LavaSpillFrame): void {
    this.spill.clear();
    const bands = lavaSpillBands(frame);
    this.spill.visible = bands.length > 0;
    const width = frame.right - frame.left;
    for (const band of bands) {
      this.spill.rect(frame.left, band.top, width, band.bottom - band.top).fill({ color: LAVA.deep, alpha: LAVA_FILL_ALPHA });
      // The surface itself, where it falls inside a band: the coral band and the crest, flat.
      if (frame.surface !== undefined && frame.surface >= band.top && frame.surface < band.bottom) {
        const coral = Math.min(TOP_BAND, band.bottom - frame.surface);
        this.spill.rect(frame.left, frame.surface, width, coral).fill({ color: LAVA.top, alpha: LAVA_FILL_ALPHA });
        this.spill.rect(frame.left, frame.surface - 1, width, 2).fill({ color: LAVA.crest, alpha: 0.85 });
      }
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.marker.destroy({ children: true });
    this.spill.destroy();
    this.emberContext.destroy();
    this.steamContext.destroy();
  }

  /** The crest's logical y at `x`: two slow sines, livelier and taller with the heat and a surge. */
  private crestY(x: number, edgeY: number, heat: number, surging: boolean): number {
    const amplitude = 3 + 4 * heat + (surging ? 4 : 0);
    const speed = 1.2 + 2 * heat;
    const t = this.seconds;
    return edgeY + amplitude * (Math.sin(x / 90 + t * speed) + 0.5 * Math.sin(x / 37 - t * 1.7 * speed));
  }

  private draw(edgeY: number, heat: number, surging: boolean, frame: LavaFrame): void {
    const left = frame.viewLeft - CREST_STEP;
    const right = frame.viewRight + CREST_STEP;
    // World y points down: a logical y is drawn at its negative.
    const crest: number[] = [];
    for (let x = left; x <= right + 0.5; x += CREST_STEP) crest.push(x, -this.crestY(x, edgeY, heat, surging));
    const bottom = -(frame.viewBottomY - FILL_DEPTH);

    this.fill.clear();
    // The whole body in magenta, then the coral band laid over its top.
    this.fill.poly([...crest, right, bottom, left, bottom]).fill({ color: LAVA.deep, alpha: LAVA_FILL_ALPHA });
    const band: number[] = [];
    for (let i = crest.length - 2; i >= 0; i -= 2) band.push(crest[i]!, crest[i + 1]! + TOP_BAND);
    this.fill.poly([...crest, ...band]).fill({ color: LAVA.top, alpha: LAVA_FILL_ALPHA });

    this.crest.clear();
    this.crest.moveTo(crest[0]!, crest[1]!);
    for (let i = 2; i < crest.length; i += 2) this.crest.lineTo(crest[i]!, crest[i + 1]!);
    this.crest.stroke({ width: 2, color: LAVA.crest, alpha: surging ? 1 : 0.7 + 0.3 * heat });

    // The glow is light, not motion: it stays under reduced motion.
    this.glow.clear();
    const strength = 0.6 + 0.4 * heat;
    const step = GLOW_HEIGHT / GLOW_STEPS.length;
    GLOW_STEPS.forEach((alpha, i) => {
      this.glow.rect(left, -(edgeY + step * (i + 1)), right - left, step).fill({ color: LAVA.glow, alpha: alpha * strength });
    });
  }

  private steamFor(frame: LavaFrame, edgeY: number): void {
    const racer = frame.racer;
    if (racer === undefined || !isSinking(racer.y, edgeY, this.tuning)) {
      this.steamWaitMs = 0;
      return;
    }
    this.steamWaitMs -= frame.deltaMs;
    if (this.steamWaitMs > 0) return;
    this.steamWaitMs = STEAM_EVERY_MS;
    const puff = this.steam.find((p) => !p.live);
    if (puff === undefined) return;
    this.launch(puff, racer.x + (this.nextSpread() - 0.5) * this.tuning.PLAYER_WIDTH, edgeY, 0, 20, 500);
  }

  private throwEmber(x: number, edgeY: number, minRise: number, maxRise: number): void {
    const ember = this.embers.find((p) => !p.live);
    if (ember === undefined) return;
    const a = this.nextSpread();
    const b = this.nextSpread();
    this.launch(ember, x, edgeY, (a - 0.5) * 20, minRise + (maxRise - minRise) * b, 600 + 600 * a);
  }

  private launch(p: Particle, x: number, y: number, vx: number, vy: number, lifeMs: number): void {
    Object.assign(p, { x, y, vx, vy, lifeMs, ageMs: 0, live: true });
    p.g.visible = true;
    p.g.position.set(x, -y);
    p.g.alpha = 1;
  }

  private advanceParticles(deltaMs: number): void {
    const seconds = Math.max(0, deltaMs) / 1000;
    for (const p of [...this.embers, ...this.steam]) {
      if (!p.live) continue;
      // Reduced motion lets what is in flight go, rather than freezing it mid-air.
      p.ageMs += deltaMs;
      if (p.ageMs >= p.lifeMs || this.reduced) {
        p.live = false;
        p.g.visible = false;
        continue;
      }
      p.x += p.vx * seconds;
      p.y += p.vy * seconds;
      p.g.position.set(p.x, -p.y);
      p.g.alpha = 1 - p.ageMs / p.lifeMs;
    }
  }

  /** An x across the view, spread evenly over frames. */
  private across(frame: LavaFrame): number {
    return frame.viewLeft + (frame.viewRight - frame.viewLeft) * this.nextSpread();
  }

  private nextSpread(): number {
    this.spread = (this.spread + GOLDEN) % 1;
    return this.spread;
  }

  private particle(layer: Container, context: GraphicsContext): Particle {
    const g = new Graphics(context);
    g.visible = false;
    layer.addChild(g);
    return { g, x: 0, y: 0, vx: 0, vy: 0, ageMs: 0, lifeMs: 1, live: false };
  }
}

