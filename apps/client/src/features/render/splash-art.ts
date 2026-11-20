/**
 * The splash art on the canvas, under the duotone dither.
 *
 * The illustration covers the whole canvas, bars and all, cropped rather than
 * letterboxed, and drawn nearest so its pixels stay square. The dither's cells
 * are one art pixel each, so the stipple is drawn at the illustration's own
 * grain and not at the screen's.
 *
 * The two pairs ping pong for as long as the splash is up, a leg per beat of
 * the menu song, and the dither's stipple crawls under the art in time with
 * it. The song's highs spike the scene bloom and the picture's saturation
 * (`MusicPulse`). Before the song is heard, the beat runs on at
 * `SPLASH_LEG_SECONDS`. Reduced motion holds the first pair, a still
 * stipple and a steady glow. A shader the device rejects leaves the art plain,
 * which is a quieter splash rather than a broken one.
 */

import { Sprite, Texture, type Filter } from "pixi.js";
import { RESURRECT64 } from "@floor-fifty/asset-contract/palette";
import type { MusicSpectrum } from "../audio";
import type { StagePort, ViewportInfo } from "./stage-port";
import { MusicPulse, type SongBeat } from "./music-pulse";
import { loadedTextures, type TextureProvider } from "./textures";
import {
  createDuotoneDitherFilter,
  setDuotoneCell,
  setDuotoneOffset,
  setDuotonePhase,
  validateDuotoneDitherProgram,
  type DuotoneDitherOptions,
} from "./filters/duotone-dither";
import { addRenderPass } from "../platform/render-order";

export const SPLASH_ART = "splash.art";

/** A Resurrect 64 swatch as a tint. */
const swatch = (index: number): number => Number.parseInt(RESURRECT64[index]!.slice(1), 16);

/**
 * Blue and white, straight from Resurrect 64: deep navy under white, then
 * royal blue under sky blue. Both tones move, so the swap reads across the
 * room, and neither pair leaves the blues.
 */
export const SPLASH_DUOTONE: DuotoneDitherOptions = {
  from: { shadow: swatch(44), highlight: swatch(9) },
  to: { shadow: swatch(46), highlight: swatch(48) },
  // The art sits in the middle of the range; stretching it keeps the racers
  // and the sky on opposite tones instead of one flat stipple.
  levels: [0.12, 0.72],
};

/**
 * One way across the ping pong until the song's own beat is heard. The splash
 * is up at least 1.2 s: one round trip.
 */
export const SPLASH_LEG_SECONDS = 0.6;

/**
 * How many cells the dither crawls a beat: one on the beat and one on the
 * half, so the crawl keeps the song's tempo. Stepped, so the grain stays crisp.
 */
export const SPLASH_DITHER_CELLS_PER_BEAT = 2;

/**
 * What a full spike of the highs does: the glow this many times its look's
 * strength, the picture this saturated, and the glow this far into the
 * duotone's sky blue, so the flare is the art's own blue rather than white.
 * Between spikes, all rest: 1, 1 and none.
 */
export const SPLASH_SPIKE = { intensity: 3.5, saturation: 1.8, tint: SPLASH_DUOTONE.to.highlight, tintAmount: 1 } as const;

export type SplashArtOptions = {
  textures?: TextureProvider;
  createFilter?: () => Filter;
  reducedMotion?: () => boolean;
  /** The song as it sounds this frame; absent, the beat runs on by itself. */
  music?: () => MusicSpectrum | undefined;
  /** Where the song is in its own beats this frame; absent, its beats are heard. */
  song?: () => SongBeat | undefined;
};

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export class SplashArt {
  /** Whether the art is on the canvas. False when its texture never arrived. */
  readonly drawn: boolean;

  private readonly sprite: Sprite | undefined;
  private readonly filter: Filter | undefined;
  private readonly release: (() => void)[] = [];

  constructor(
    private readonly stage: StagePort,
    options: SplashArtOptions = {},
  ) {
    const texture = (options.textures ?? loadedTextures)(SPLASH_ART);
    this.drawn = texture !== Texture.EMPTY;
    if (!this.drawn) return;

    texture.source.scaleMode = "nearest";
    const sprite = new Sprite(texture);
    sprite.label = "splash-art";
    sprite.anchor.set(0.5);
    stage.backdrop.addChild(sprite);
    this.sprite = sprite;

    try {
      const filter = options.createFilter?.() ?? createDuotoneDitherFilter(SPLASH_DUOTONE);
      if (options.createFilter === undefined && stage.webgl !== undefined) {
        validateDuotoneDitherProgram(stage.webgl, filter);
      }
      sprite.filters = [filter];
      this.filter = filter;
    } catch {
      this.filter = undefined;
    }

    this.layout(stage.viewport);
    this.release.push(stage.onViewportChange((viewport) => this.layout(viewport)));

    const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
    const pulse = new MusicPulse(SPLASH_LEG_SECONDS);
    const tick = (): void => {
      if (this.filter === undefined) return;
      const deltaMs = stage.app?.ticker.deltaMS ?? 0;
      if (reducedMotion()) {
        setDuotonePhase(this.filter, 0);
        setDuotoneOffset(this.filter, 0, 0);
        stage.setBloomPulse?.(undefined);
        return;
      }
      const frame = pulse.update(deltaMs / 1000, options.music?.(), options.song?.());
      setDuotonePhase(this.filter, frame.phase);
      // A diagonal crawl counted in beats, so it moves as fast as the song. A
      // beat running late holds its last cell rather than taking the next's.
      const within = Math.min(SPLASH_DITHER_CELLS_PER_BEAT - 1, Math.floor(frame.progress * SPLASH_DITHER_CELLS_PER_BEAT));
      const step = frame.beats * SPLASH_DITHER_CELLS_PER_BEAT + within;
      setDuotoneOffset(this.filter, step, Math.floor(step / 2));
      stage.setBloomPulse?.({
        intensity: 1 + (SPLASH_SPIKE.intensity - 1) * frame.spike,
        saturation: 1 + (SPLASH_SPIKE.saturation - 1) * frame.spike,
        tint: SPLASH_SPIKE.tint,
        tintAmount: SPLASH_SPIKE.tintAmount * frame.spike,
      });
    };
    const ticker = stage.app?.ticker;
    const removePass = ticker !== undefined ? addRenderPass(ticker as any, "gameplayDraw", tick) : () => {};
    this.release.push(() => {
      removePass();
      stage.setBloomPulse?.(undefined);
    });
  }


  /** The phase drawn last, for a test or an inspection. */
  get phase(): number {
    const group = this.filter?.resources["duotoneUniforms"] as { uniforms: { uPhase: number } } | undefined;
    return group?.uniforms.uPhase ?? 0;
  }

  dispose(): void {
    for (const release of this.release.splice(0)) release();
    // The texture is the asset cache's; only what this made goes.
    this.filter?.destroy();
    this.sprite?.destroy({ texture: false });
  }

  private layout(viewport: ViewportInfo): void {
    const sprite = this.sprite;
    if (sprite === undefined) return;
    const cover = viewport.sceneryLogical;
    const scale = Math.max(cover.width / sprite.texture.width, cover.height / sprite.texture.height);
    sprite.scale.set(scale);
    sprite.position.set(cover.x + cover.width / 2, cover.y + cover.height / 2);
    // Output pixels per art pixel: logical units per texel, CSS pixels per
    // unit, device pixels per CSS pixel.
    if (this.filter !== undefined) setDuotoneCell(this.filter, scale * this.stage.cellSize * this.stage.pixelRatio);
  }
}
