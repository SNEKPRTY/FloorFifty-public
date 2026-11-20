/**
 * The stage, answering (Wonder spec §6.2–6.3): the song's beats bob the city,
 * heavy kicks surge the drifting sky, a slam jolts the near city and flashes
 * its windows, a streak lifts the glow, and all of it grows with the climb.
 *
 * Pure: it turns a pulse, an intensity and the frame's moments into layer
 * motion (`StageMotion`, for `StageLayers`) and window light (`glowLift`,
 * `windowFlash`, for the city shader). The bob and the jolt ride the jolt
 * spring and are drawn on whole units. Nothing here touches a floor or a
 * racer: it is scenery moving, never the camera.
 */

import type { SpringTuning } from "@floor-fifty/shared/content/game-content";
import { SecondOrder, snapTo } from "../../lib/second-order";
import type { PulseFrame } from "./music-pulse";

export type StageMotion = {
  /** Every city layer's beat bob, in world units, scaled by its depth. */
  readonly bob: number;
  /** The nearest city layers' jolt, in world units. */
  readonly jolt: number;
  /** Extra drift distance for the drifting sky layers, accumulated. */
  readonly surge: number;
  /** Extra drift speed for named layers, in units a second: a set piece's sweep (Wonder spec §6.4). */
  readonly swarm?: ReadonlyMap<string, number>;
};

export type StageReactorInput = {
  readonly dtSeconds: number;
  readonly pulse: PulseFrame | undefined;
  /** 0 to 1: how far up the climb the camera is, in five bands. */
  readonly intensity: number;
  /** Slams drawn this frame. */
  readonly slams: number;
  /** The local racer's floors in a row. */
  readonly streak: number;
  readonly reduced: boolean;
  /** At `low` quality the stage only glows: no bob, jolt or surge (Wonder spec §6.6). */
  readonly low?: boolean;
  /** The player has switched stage effects off: the city stands still and unlit. */
  readonly off?: boolean;
};

/** How hard a beat bobs the city, in units, at the bottom and the top of the climb. */
const BOB_UNITS = 1;
/** How far a slam jolts the near city, in units. */
const JOLT_UNITS = 4;
/** A kick past this is heavy enough to surge the sky. */
const HEAVY_KICK = 0.6;
/** How fast a heavy kick drives the sky's drift, in units a second at full kick and the bottom of the climb. */
const SURGE_SPEED = 30;
/** How long a slam's window flash lasts. */
const FLASH_SECONDS = 0.4;
/** Flashes start no closer than this: under three a second (WCAG 2.3.1). */
const FLASH_SPACING_SECONDS = 0.334;
/** The glow a streak of five or more adds, and the most the climb adds. */
const STREAK_GLOW = 0.3;
const CLIMB_GLOW = 0.4;
const STREAK_FROM = 5;
const RESTING_SPRING: SpringTuning = { f: 5, zeta: 0.3, r: 0 };

/** The slams among `moments` the camera can see: within `halfHeight` of its centre, in world units. */
export function slamsInView(moments: readonly { readonly kind: string; readonly y: number }[], cameraY: number, halfHeight: number): number {
  return moments.filter((moment) => moment.kind === "slam" && Math.abs(moment.y - cameraY) <= halfHeight).length;
}

/** The camera's height as a share of the climb, in five bands: 0, 0.25, 0.5, 0.75, 1. */
export function intensityAt(cameraY: number, raceHeight: number): number {
  if (raceHeight <= 0) return 0;
  const share = Math.min(1, Math.max(0, cameraY / raceHeight));
  return Math.min(4, Math.floor(share * 5)) / 4;
}

export class StageReactor {
  private readonly bob: SecondOrder;
  private readonly jolt: SecondOrder;
  private surge = 0;
  private lastBeats: number | undefined;
  private flash = 0;
  private sinceFlash = Number.POSITIVE_INFINITY;
  private glow = 0;

  constructor(private readonly spring: () => SpringTuning | undefined) {
    this.bob = new SecondOrder(spring() ?? RESTING_SPRING);
    this.jolt = new SecondOrder(spring() ?? RESTING_SPRING);
  }

  update(input: StageReactorInput): StageMotion {
    if (input.off === true) {
      this.glow = 0;
      this.flash = 0;
      this.bob.set(0);
      this.jolt.set(0);
      return { bob: 0, jolt: 0, surge: 0 };
    }
    const tuning = this.spring() ?? RESTING_SPRING;
    this.bob.retune(tuning);
    this.jolt.retune(tuning);
    this.glow = input.intensity * CLIMB_GLOW + (input.streak >= STREAK_FROM ? STREAK_GLOW : 0);

    const beats = input.pulse?.beats;
    const beat = beats !== undefined && this.lastBeats !== undefined && beats !== this.lastBeats;
    if (beats !== undefined) this.lastBeats = beats;

    // The steady glow stays under reduced motion; the flash does not, and it
    // never restarts within a third of a second, however many racers slam.
    this.sinceFlash += input.dtSeconds;
    if (input.reduced) this.flash = 0;
    else if (input.slams > 0 && this.sinceFlash >= FLASH_SPACING_SECONDS) {
      this.flash = 1;
      this.sinceFlash = 0;
    } else this.flash = Math.max(0, this.flash - input.dtSeconds / FLASH_SECONDS);

    if (input.reduced || input.low === true) {
      this.bob.set(0);
      this.jolt.set(0);
      return { bob: 0, jolt: 0, surge: 0 };
    }
    if (beat) this.bob.lift(BOB_UNITS * (1 + input.intensity));
    if (input.slams > 0) this.jolt.lift(JOLT_UNITS);
    const kick = input.pulse?.kick ?? 0;
    if (kick > HEAVY_KICK) this.surge += input.dtSeconds * kick * SURGE_SPEED * (0.5 + input.intensity);
    this.bob.update(input.dtSeconds, 0);
    this.jolt.update(input.dtSeconds, 0);
    // A bob is a dip: the city settles down on the beat and springs back.
    return { bob: snapTo(-this.bob.value, 1), jolt: snapTo(this.jolt.value, 1), surge: this.surge };
  }

  /** The glow the climb and a streak add to the city's windows. */
  get glowLift(): number {
    return this.glow;
  }

  /** A slam's window flash, 1 falling to 0 over a beat. */
  get windowFlash(): number {
    return this.flash;
  }
}
