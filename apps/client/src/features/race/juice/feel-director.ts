/**
 * The feel layer (A/V polish plan, G1–G6): presentation only.
 *
 * Beside the juice director rather than inside it: the juice answers what
 * each racer's body does (a squash, a puff, a lean), and this answers what
 * the player's *view* and *hands* do about it. It reads the moments and events
 * a juice frame answered and the local racer's drawn fall, and drives:
 *
 * - trauma shake (`Trauma`): the local slam, fall and the finish, and a little
 *   for a rival's slam on screen;
 * - the zoom punch, on its spring;
 * - impact frames: a flat flash, never closer than `impact.gapMs`;
 * - the fast-fall's speed lines and afterimages, and the camera's look-ahead;
 * - the LCD panel's aberration pulse;
 * - haptics (`hapticsFor`), which reduced motion leaves alone.
 *
 * Reduced motion stills every visual here. Nothing reads into the race.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceEvent } from "@floor-fifty/shared/common/protocol";
import type { FeelTuning } from "@floor-fifty/shared/content/game-content";
import { hapticsFor, type HapticKind } from "../../platform/haptics";
import type { FallTrailTuning } from "./fall-trail";
import { SecondOrder } from "../../../lib/second-order";
import { Trauma } from "./trauma";

export interface FeelView {
  /** The shake for this frame, in world units; zeros at rest. */
  setShake(x: number, y: number): void;
  /** The zoom's punch, a share of the zoom. */
  setPunch(share: number): void;
  /** How far the camera leads the followed racer, in world units (negative is below). */
  setLookAhead(units: number): void;
  /** The impact flash's alpha; 0 is none. */
  setImpact(alpha: number): void;
  /** The fast-fall's lines and afterimages, 0 (none) to 1 (full), drawn with `feel.fall`. */
  setFall(share: number, tuning: FallTrailTuning): void;
  /** Aberration added to the LCD panel's own. */
  setAberration(extra: number): void;
}

export type FeelFrame = {
  /** The scene's presentation clock, which slows with the finish. */
  readonly nowMs: number;
  readonly localId: PlayerId | undefined;
  /** The local racer as drawn; undefined when there is none. */
  readonly local: { readonly y: number; readonly vy: number } | undefined;
  /** Whether a height is on screen now, through the camera's zoom: a rival's slam there shakes the view. */
  readonly onScreen: (y: number) => boolean;
  readonly moments: readonly { readonly kind: string; readonly playerId: PlayerId; readonly y: number }[];
  readonly reached: readonly RaceEvent[];
};

export type FeelDeps = {
  readonly view: FeelView;
  /** The tuning, read every frame; nothing before content has loaded. */
  readonly feel: () => FeelTuning | undefined;
  /** `FAST_FALL_VELOCITY`'s size: the fall the lines measure against. */
  readonly fastFall: number;
  /** `reducedMotion()`, read at the moment of use. */
  readonly reduced: () => boolean;
  /** Sends a pulse to the hands; see `Haptics`. */
  readonly haptic?: (kind: HapticKind) => void;
};

/** No trail: reduced motion, or no content. */
const NO_TRAIL: FallTrailTuning = { lines: 0, alpha: 0, afterimages: 0, afterimageAlpha: 0 };

/** A spring for before content has loaded. */
const RESTING = { f: 3, zeta: 0.6, r: 0 } as const;

export class FeelDirector {
  private readonly shake = new Trauma();
  private readonly punch: SecondOrder;
  private lastNowMs: number | undefined;
  private impactUntilMs = Number.NEGATIVE_INFINITY;
  private lastImpactMs = Number.NEGATIVE_INFINITY;
  /** The flash under way: a slam's, softer, or the finish's. */
  private impactAlpha = 0;
  private aberrationAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: FeelDeps) {
    this.punch = new SecondOrder(deps.feel()?.punch.spring ?? RESTING);
  }

  /** The shake's trauma now, 0 to 1. */
  get trauma(): number {
    return this.shake.level;
  }

  frame(input: FeelFrame): void {
    const deltaMs = this.lastNowMs === undefined ? 0 : Math.max(0, input.nowMs - this.lastNowMs);
    this.lastNowMs = input.nowMs;
    // The hands feel the race whatever the screen does.
    if (this.deps.haptic !== undefined) for (const kind of hapticsFor(input, input.localId)) this.deps.haptic(kind);

    const feel = this.deps.feel();
    if (feel === undefined || this.deps.reduced()) {
      this.restart();
      this.rest();
      return;
    }

    const dt = deltaMs / 1_000;
    this.shake.update(dt, feel.shake.decayPerSecond);
    this.punch.retune(feel.punch.spring);
    this.punch.update(dt, 0);

    const self = input.local;
    let hit = false;
    let flash = 0;
    for (const moment of input.moments) {
      if (moment.kind !== "slam") continue;
      if (moment.playerId === input.localId) {
        this.shake.add(feel.shake.slam);
        this.punch.lift(feel.punch.slam);
        hit = true;
        flash = Math.max(flash, feel.impact.slam);
      } else if (input.onScreen(moment.y)) {
        this.shake.add(feel.shake.rivalSlam);
      }
    }
    for (const event of input.reached) {
      if ((event.type === "playerReset" || event.type === "playerOut") && event.playerId === input.localId) {
        this.shake.add(feel.shake.fall);
      } else if (event.type === "raceFinished") {
        this.shake.add(feel.shake.finish);
        this.punch.lift(feel.punch.finish);
        hit = true;
        flash = Math.max(flash, feel.impact.alpha);
      }
    }
    if (hit) {
      this.aberrationAtMs = input.nowMs;
      // Never closer than the gap: three flashes a second is the photosensitivity ceiling.
      if (input.nowMs - this.lastImpactMs >= feel.impact.gapMs) {
        this.lastImpactMs = input.nowMs;
        this.impactUntilMs = input.nowMs + feel.impact.ms;
        this.impactAlpha = flash;
      }
    }

    // A spring at rest is snapped there, so a settled punch stops asking the view.
    if (this.punch.settled) this.punch.set(0);
    const offset = this.shake.offset(input.nowMs / 1_000, feel.shake);
    const since = input.nowMs - this.aberrationAtMs;
    const fall = fallShare(self?.vy, this.deps.fastFall, feel.fall.from);
    this.draw({
      shakeX: offset.x,
      shakeY: offset.y,
      punch: this.punch.value,
      impact: input.nowMs < this.impactUntilMs ? this.impactAlpha : 0,
      aberration: feel.aberration.ms > 0 && since < feel.aberration.ms ? feel.aberration.peak * (1 - since / feel.aberration.ms) : 0,
      fall,
      trail: feel.fall,
      lookAhead: fall > 0 ? Math.max(-feel.lookAhead.maxUnits, self!.vy * feel.lookAhead.seconds) : 0,
    });
  }

  /** Settles everything at once: a rewind, reduced motion, or no content. */
  restart(): void {
    this.shake.settle();
    this.punch.set(0);
    this.impactUntilMs = Number.NEGATIVE_INFINITY;
    this.aberrationAtMs = Number.NEGATIVE_INFINITY;
  }

  private rest(): void {
    this.draw({ shakeX: 0, shakeY: 0, punch: 0, impact: 0, aberration: 0, fall: 0, trail: NO_TRAIL, lookAhead: 0 });
  }

  /**
   * Tells the view what changed since the last frame, and nothing else: a
   * race at rest -- or under reduced motion -- writes nothing, so the LCD
   * panel's uniform is not re-uploaded every frame to hold the same value.
   */
  private draw(next: FeelDrawn): void {
    const last = this.drawn;
    const view = this.deps.view;
    if (last?.shakeX !== next.shakeX || last.shakeY !== next.shakeY) view.setShake(next.shakeX, next.shakeY);
    if (last?.punch !== next.punch) view.setPunch(next.punch);
    if (last?.impact !== next.impact) view.setImpact(next.impact);
    if (last?.aberration !== next.aberration) view.setAberration(next.aberration);
    if (last?.fall !== next.fall || last.trail !== next.trail) view.setFall(next.fall, next.trail);
    if (last?.lookAhead !== next.lookAhead) view.setLookAhead(next.lookAhead);
    this.drawn = next;
  }

  /** What the view was last told; undefined before the first frame. */
  private drawn: FeelDrawn | undefined;
}

type FeelDrawn = {
  readonly shakeX: number;
  readonly shakeY: number;
  readonly punch: number;
  readonly impact: number;
  readonly aberration: number;
  readonly fall: number;
  readonly trail: FallTrailTuning;
  readonly lookAhead: number;
};

/**
 * How far into a fast fall the racer is, 0 to 1: nothing until it passes
 * `from` of the fast-fall speed, everything at the full speed. A rise is none.
 */
export function fallShare(vy: number | undefined, fastFall: number, from: number): number {
  if (vy === undefined || vy >= 0 || fastFall <= 0) return 0;
  const speed = -vy / fastFall;
  if (speed <= from) return 0;
  return from >= 1 ? 1 : Math.min(1, (speed - from) / (1 - from));
}
