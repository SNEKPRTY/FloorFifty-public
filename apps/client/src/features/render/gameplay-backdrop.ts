/**
 * The gameplay scenery controller.
 *
 * Owns everything about how the scenery is drawn: the bounded target the sky
 * is rendered into, the two filter chains, and the time those filters are fed.
 * The screen owns the controller and its clock; the view keeps building
 * scenery exactly as it did.
 *
 * The scenery is two plates (launch polish spec, phase 1):
 *
 * - The **sky** -- sun and clouds -- is the optical plate. It is rendered into
 *   the bounded target, through sky, refraction and the palette lock, and the
 *   target's output is stretched back over the canvas with linear sampling.
 *   Soft is the point.
 * - The **city** -- every skyline, its windows and the rooftop props -- is the
 *   crisp stack. It is parented to the backdrop layer directly above the sky
 *   plate's output and drawn at device resolution through the atmosphere and a
 *   palette lock of its own. Nothing on it blurs.
 *
 * Ownership is the whole point of the class, and it is asymmetric on purpose:
 *
 * - The **lease** is borrowed from the stage and released on the way out.
 * - The **sky's palette lock** is borrowed from the backdrop layer, because the
 *   app built one instance for the life of the tab. It is moved onto the sky
 *   chain rather than shared with it: one live Pixi filter instance carries
 *   per-target render state, so attaching the same one to two targets is a
 *   silent corruption. The layer's own array is put back on teardown.
 * - The **city's palette lock** is a third instance -- the app's two are the
 *   composite's and the layer's -- built here from the stage and destroyed here.
 * - The **sky, city and refraction** passes are built here, per mount, and
 *   destroyed here. A race that did not release them would leak their programs
 *   for the life of the tab.
 *
 * Failure is graded, not fatal. A refraction program that will not compile
 * loses refraction and nothing else. A bounded target that cannot be created
 * falls back to the direct backdrop with the baseline chain, and deliberately
 * does not add refraction -- running the pass unbounded is the cost this class
 * exists to avoid.
 */

import { setPaletteMood } from "./filters/palette-lock";
import type { Container, Filter } from "pixi.js";
import { roleTint } from "@floor-fifty/asset-contract/roles";
import type { BackdropLease, StagePort, ViewRect } from "./stage-port";
import { resolveCityFilters, resolveSkyFilters, type QualityLevel } from "../profile/quality";
import type { StagePresentation } from "./stage-presentation";
import { createSkyFilter, setSkyMusic, setSkyProgress } from "./filters/dither-sky";
import type { PulseFrame } from "./music-pulse";
import { createCityFilter, setCityGlow, setCityTime, setCityLightsOut } from "./filters/city-atmosphere";
import {
  createDawnRefractionFilter,
  setDawnRefractionFrame,
  setDawnRefractionViewport,
  validateDawnRefractionProgram,
  type DawnRefractionFilter,
} from "./filters/dawn-refraction";

/**
 * The scenery's optical strength.
 *
 * 0.65 until Task 5 lets content choose it. The spec's entry value: strong
 * enough that the high profile is visibly refracted at rest, weak enough that
 * the warp stays inside the bound its profile constants were scaled to.
 */
export const GAMEPLAY_REFRACTION_INTENSITY = 0.65;

/** The two scenery plates a race hands the controller. */
/**
 * What the race's song, as heard, does to the scenery (`MusicPulse`), on top
 * of the authored beat the view already pulses the windows with.
 *
 * `windowKick` and `windowSpike` are window glow added at a full kick and a
 * full spike of the highs. `surge` is how far a full kick heaves the sky's
 * warm bands up the frame, in frame heights: about twenty units at 540.
 * Every beat also reshuffles the sky's stipple, as the splash's does.
 */
export const GAMEPLAY_MUSIC_PULSE = { windowKick: 4.8, windowSpike: 1.1, surge: 0.035 } as const;
/** How much a slam's window flash adds to the glow at its height (Wonder spec §6.3). */
const FLASH_GLOW = 2;
/**
 * The most the song and a slam may lift the windows over their rest, in glow
 * units: one step of the city shader's ramp (`GLOW_GAIN` 0.3 × 1 = 0.3), so a
 * window moves at most one swatch, never dim to hot (the audit's flash rule).
 */
export const WINDOW_SWING = 1;
/** The windows' lift rises no more often than this: under three times a second (WCAG 2.3.1). */
const WINDOW_RISE_SPACING_S = 0.334;
/** No tint: a mood at rest. */
const NEUTRAL: readonly [number, number, number] = [1, 1, 1];

export type GameplayScenery = {
  sky: Container;
  city: Container;
  /** Whether the city's windows carry codes (`window-code.ts`). */
  windowsCoded?: boolean;
};

export type GameplayBackdropOptions = {
  quality: QualityLevel;
  /**
   * The frozen presentation of the stage this race is on.
   *
   * Supplied once at entry and never re-read. The controller holds it for the
   * life of the mount, so a content refresh mid-race changes nothing about what
   * is on screen -- which is the spec's rule, enforced by there being no way
   * for a later value to reach this object.
   */
  presentation?: StagePresentation;
  intensity?: number;
  createRefraction?: (quality: QualityLevel) => DawnRefractionFilter;
  /** Builds the city's refraction; injectable for tests. */
  createCityRefraction?: (quality: QualityLevel) => DawnRefractionFilter;
  validateRefraction?: (filter: DawnRefractionFilter) => void;
};

export class GameplayBackdrop {
  /** Set only where a refraction pass is actually in the chain. */
  private refractionFilter: DawnRefractionFilter | undefined;
  private cityFilter: Filter | undefined;
  private cityLock: Filter | undefined;
  /** The city's soft refraction (spec §2.9); absent unbounded or when it won't compile. */
  private cityRefraction: DawnRefractionFilter | undefined;
  private skyFilter: Filter | undefined;
  private lease: BackdropLease | undefined;
  private borrowedFilters: Filter[] = [];
  private destroyed = false;

  /**
   * The intensity the refraction is driven at.
   *
   * The stage's authored value when it has one, and the spec's entry value
   * otherwise. The explicit option wins so a test or a probe can pin it.
   */
  readonly intensity: number;
  /** The stage presentation this mount was built from. Frozen at entry. */
  readonly presentation: StagePresentation | undefined;
  /** Whether the scenery is being drawn through a bounded target. */
  readonly bounded: boolean;

  private readonly city: Container;
  /** The view's glow, before the heard song adds to it. */
  private glow = 0;
  /** The climb's and a streak's lift, and a slam's flash (Wonder spec §6.3). */
  private stageLift = 0;
  private flash = 0;
  /** The song's and a slam's lift as drawn: one envelope, rate-limited and capped. */
  private swing = 0;
  private swingRoseAt = Number.NEGATIVE_INFINITY;
  private time = 0;
  /** A set piece's mood, on both locks, and a sky flash over it on the sky's alone (Wonder spec §6.4). */
  private mood: { tint: readonly [number, number, number]; mix: number } = { tint: NEUTRAL, mix: 0 };
  private skyFlash: { tint: readonly [number, number, number]; strength: number } = { tint: NEUTRAL, strength: 0 };
  /** The sky plate's brightest colour: no flash goes past it (Wonder spec §6.6). */
  private flashCeil: readonly [number, number, number] = NEUTRAL;
  /** This frame of the song as heard; undefined for a still scenery. */
  private heard: PulseFrame | undefined;

  constructor(
    private readonly stage: StagePort,
    scenery: GameplayScenery,
    private readonly options: GameplayBackdropOptions,
  ) {
    this.city = scenery.city;
    this.presentation = options.presentation;
    this.intensity =
      options.intensity ?? options.presentation?.refractionIntensity ?? GAMEPLAY_REFRACTION_INTENSITY;

    // Built before the target so a compile failure cannot leave a lease behind.
    this.skyFilter = createSkyFilter({
      high: roleTint("skyHigh"),
      mid: roleTint("skyMid"),
      low: roleTint("skyLow"),
    });
    this.cityFilter = createCityFilter({
      window: roleTint("cityWindow"),
      ramp: {
        dim: roleTint("cityWindowDim"),
        bright: roleTint("cityWindowBright"),
        hot: roleTint("cityWindowHot"),
      },
      coded: scenery.windowsCoded === true,
    });
    this.cityLock = stage.createPaletteLock();
    if (this.cityLock !== undefined) {
      // At the canvas's own resolution, for the reason `createCityFilter` gives.
      this.cityLock.resolution = "inherit";
    }

    const lease = this.mount(scenery);
    this.bounded = lease !== undefined;
    this.lease = lease;

    // The refraction is only worth compiling where there is a bounded frame for
    // it to read: unbounded, it is the expensive pass this class exists to
    // bound, and the spec's answer is to leave it off rather than pay for it.
    if (lease !== undefined) {
      this.refractionFilter = this.buildRefraction();
      // Every background layer is refracted, the city with the same soft,
      // diffusing optics as the sky: the user asked for the blur back, since
      // without it the skyline lacked its aura (spec §2.9, as amended).
      // Skipped with no bounded target, the degraded path, like the sky's.
      this.cityRefraction = this.buildRefraction(
        this.options.createCityRefraction ??
          ((quality: QualityLevel) => createDawnRefractionFilter(quality, "gameplay")),
      );
    }

    this.applyChain(lease);
  }

  /** The target the scenery is drawn into, when there is one. */
  get targetSize(): Readonly<{ width: number; height: number }> | undefined {
    return this.lease?.targetSize;
  }

  /** What that target's texture actually reserves, which is not its area. */
  get pooledCapacity(): number | undefined {
    return this.lease?.pooledCapacity;
  }

  /**
   * Whether a refraction pass is actually in this mount's chain.
   *
   * Not the same question as "was one asked for". A program that would not
   * compile drops out and leaves the race playable, so the only honest answer
   * is whether a filter survived -- which is what a capture that claims to be
   * looking at refracting scenery needs to know.
   */
  get refractionActive(): boolean {
    return this.refractionFilter !== undefined;
  }

  /** Whether the city's refraction is in its chain. */
  get cityRefractionActive(): boolean {
    return this.cityRefraction !== undefined;
  }

  /**
   * Tells the city's refraction which logical rectangle it shades and at what density.
   *
   * The city is drawn over the whole canvas, so its refraction measures the
   * warp against the scenery rectangle; re-told on every layout,
   * or a rotation would change the ripple's scale.
   */
  setViewport(scenery: ViewRect, pixelsPerUnit: number): void {
    if (this.destroyed || this.cityRefraction === undefined) return;
    setDawnRefractionViewport(this.cityRefraction, scenery, {
      width: Math.round(scenery.width * pixelsPerUnit),
      height: Math.round(scenery.height * pixelsPerUnit),
    });
  }

  /**
   * Advances the atmosphere and the optics.
   *
   * One call per frame with the ambient clock's time, so the twinkle and the
   * refraction cannot drift apart: two things easing on their own clocks would
   * eventually disagree about the moment, and the disagreement shows.
   */
  update(timeSeconds: number): void {
    if (this.destroyed) return;
    this.time = timeSeconds;
    if (this.cityFilter !== undefined) setCityTime(this.cityFilter, timeSeconds);
    if (this.refractionFilter !== undefined) {
      // No entry ease and no beat modulation: the menu's profile scales its
      // intensity in over the first 0.6s because its backdrop appears behind a
      // screen change. Here the scenery has been on screen since before the
      // countdown finished, so an ease would be an entrance nobody witnessed.
      setDawnRefractionFrame(this.refractionFilter, timeSeconds, this.intensity);
    }
    if (this.cityRefraction !== undefined) setDawnRefractionFrame(this.cityRefraction, timeSeconds, this.intensity);
  }

  /** Raises the horizon with the local racer's climb. */
  setProgress(progress: number): void {
    if (this.destroyed || this.skyFilter === undefined) return;
    setSkyProgress(this.skyFilter, progress);
  }

  /** Scales the city's window glow with the beat. The view owns the pulse's shape. */
  setGlow(strength: number): void {
    this.glow = strength;
    this.applyGlow();
  }

  /**
   * A set piece's mood (Wonder spec §6.4): both palette locks tint toward it
   * before they snap, so the world steps toward the mood in swatches. Present
   * at every quality: the locks are in every chain.
   */
  setMood(tint: readonly [number, number, number], mix: number): void {
    this.mood = { tint, mix };
    this.applyMood();
  }

  /** A set piece's lights-out wave in the city's windows; nothing at `low`, which drops the atmosphere pass. */
  setLightsOut(share: number, invert: boolean, relit = 0): void {
    if (this.destroyed || this.cityFilter === undefined || this.options.quality === "low") return;
    setCityLightsOut(this.cityFilter, share, invert, relit);
  }

  /** The sky plate's brightest colour, which every sky flash is held under. */
  setFlashCeiling(rgb: readonly [number, number, number]): void {
    this.flashCeil = rgb;
    this.applyMood();
  }

  /** A lightning or aurora flash on the sky's lock, over its mood; 0 gives the mood back. */
  setSkyFlash(tint: readonly [number, number, number], strength: number): void {
    this.skyFlash = { tint, strength };
    this.applyMood();
  }

  private applyMood(): void {
    if (this.destroyed) return;
    if (this.cityLock !== undefined) setPaletteMood(this.cityLock, this.mood.tint, this.mood.mix);
    const skyLock = this.borrowedFilters[this.borrowedFilters.length - 1];
    if (skyLock === undefined) return;
    if (this.skyFlash.strength > 0) setPaletteMood(skyLock, this.skyFlash.tint, this.skyFlash.strength, this.flashCeil);
    else setPaletteMood(skyLock, this.mood.tint, this.mood.mix);
  }

  /** The stage's own lift to the windows: the climb, a streak, and a slam's flash, 0 to 1. */
  setStageLift(lift: number, flash: number): void {
    this.stageLift = lift;
    this.flash = flash;
    this.applyGlow();
  }

  /**
   * The song as heard this frame, or `undefined` to rest: no music, or
   * reduced motion. The windows add its kick and highs to the view's glow,
   * and the sky heaves on the kick and reshuffles its stipple on each beat.
   */
  setMusic(frame: PulseFrame | undefined): void {
    if (this.destroyed) return;
    this.heard = frame;
    if (this.skyFilter !== undefined) {
      // Half the table's width on every beat, the largest jump there is.
      const beats = frame?.beats ?? 0;
      setSkyMusic(this.skyFilter, (frame?.kick ?? 0) * GAMEPLAY_MUSIC_PULSE.surge, beats * 2, beats);
    }
    this.applyGlow();
  }

  private applyGlow(): void {
    if (this.destroyed || this.cityFilter === undefined) return;
    const heard = this.heard;
    const wanted = Math.min(
      WINDOW_SWING,
      (heard === undefined ? 0 : heard.kick * GAMEPLAY_MUSIC_PULSE.windowKick + heard.spike * GAMEPLAY_MUSIC_PULSE.windowSpike) +
        this.flash * FLASH_GLOW,
    );
    // The kick, the highs and a slam share one lift: it falls with them at
    // once, and rises again only a third of a second after it last rose, so
    // however they stack the windows flash under three times a second.
    if (wanted < this.swing) this.swing = wanted;
    else if (wanted > this.swing && this.time - this.swingRoseAt >= WINDOW_RISE_SPACING_S) {
      this.swing = wanted;
      this.swingRoseAt = this.time;
    }
    setCityGlow(this.cityFilter, this.glow + this.stageLift + this.swing);
  }

  /**
   * Releases everything, in the order the ownership rules require.
   *
   * Idempotent: a screen that exits twice, or exits after a failed entry, must
   * not double-destroy a filter or a texture.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // The city first: it was parented here, so it is unparented here, and its
    // chain goes with it before the passes in it are destroyed.
    this.city.filters = [];
    this.city.parent?.removeChild(this.city);

    // Owned passes next, while nothing is rendering through them.
    for (const filter of [this.skyFilter, this.cityFilter, this.cityLock, this.refractionFilter, this.cityRefraction]) {
      filter?.destroy();
    }
    this.cityRefraction = undefined;
    this.skyFilter = undefined;
    this.cityFilter = undefined;
    this.cityLock = undefined;
    this.refractionFilter = undefined;

    // Then the borrowed layer, then the lease. Restoring before the release
    // means the frame after teardown is already the one the next screen wants:
    // the sky's lock goes back neutral, so no set piece's mood leaves the race.
    const skyLock = this.borrowedFilters[this.borrowedFilters.length - 1];
    if (skyLock !== undefined) setPaletteMood(skyLock, NEUTRAL, 0);
    this.stage.backdrop.filters = this.borrowedFilters;
    this.lease?.destroy();
    this.lease = undefined;
  }

  /**
   * Takes the bounded target for the sky, or reports that there is none.
   *
   * A target that cannot be created is not a failed race: the scenery still
   * draws, at device resolution and without refraction, which is exactly what
   * the game did before this pass existed.
   *
   * The city is parented after the lease, so it lands above the sky plate's
   * output in the backdrop layer -- in front of the sky and behind the field's
   * play area, which is the order the eye reads depth in.
   */
  private mount(scenery: GameplayScenery): BackdropLease | undefined {
    const borrowed = (this.stage.backdrop.filters ?? []) as readonly Filter[];
    this.borrowedFilters = [...borrowed];
    let lease: BackdropLease | undefined;
    try {
      lease = this.stage.mountBackdrop(scenery.sky);
      // Cleared while the lease is alive: the lock that was here is now the
      // last member of the sky chain, and one instance may not serve two
      // targets. `destroy` puts the array back.
      this.stage.backdrop.filters = [];
    } catch {
      // No bounded frame. Draw the sky where it has always been drawn.
      this.stage.backdrop.addChild(scenery.sky);
    }
    this.stage.backdrop.addChild(scenery.city);
    return lease;
  }

  private buildRefraction(
    create: (quality: QualityLevel) => DawnRefractionFilter = this.options.createRefraction ??
      ((quality: QualityLevel) => createDawnRefractionFilter(quality, "gameplay")),
  ): DawnRefractionFilter | undefined {
    let candidate: DawnRefractionFilter | undefined;
    try {
      candidate = create(this.options.quality);
      const validate =
        this.options.validateRefraction ??
        ((filter: DawnRefractionFilter) => {
          if (this.stage.webgl !== undefined) validateDawnRefractionProgram(this.stage.webgl, filter);
        });
      validate(candidate);
      return candidate;
    } catch {
      // Only refraction is lost. The rest of the chain is the art direction and
      // the scenery is the game; a failed program must not take either.
      candidate?.destroy();
      return undefined;
    }
  }

  /**
   * Installs both chains.
   *
   * The sky's palette lock is whatever the backdrop layer was already carrying,
   * and it stays last: everything above it produces the off-palette blends it
   * exists to fold back into the 64 swatches. The city's chain is the same
   * whether or not there is a target -- the city was never in the target.
   */
  private applyChain(lease: BackdropLease | undefined): void {
    const quality = this.options.quality;
    this.city.filters = resolveCityFilters(quality, {
      city: this.cityFilter,
      refraction: this.cityRefraction,
      paletteLock: this.cityLock,
    });

    const sky = resolveSkyFilters(quality, {
      sky: this.skyFilter,
      // Absent without a target, by the rule above.
      refraction: this.refractionFilter,
      paletteLock: this.borrowedFilters[this.borrowedFilters.length - 1],
    });

    if (lease === undefined) {
      // On the layer rather than the sky container, so the dithered sky still
      // paints the whole canvas: a filter's area is its container's bounds, and
      // the sky container's are only the sun and the clouds.
      this.stage.backdrop.filters = sky;
      return;
    }

    lease.filterRoot.filters = sky;
    if (this.refractionFilter !== undefined) {
      // Told once, here, rather than per frame: the rectangle only changes when
      // the viewport does, and the app re-fits the target for us.
      setDawnRefractionViewport(this.refractionFilter, lease.logicalRect, lease.targetSize);
    }
  }
}
