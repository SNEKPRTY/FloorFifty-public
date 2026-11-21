/**
 * The lava and the wind (story mode v2 spec, "The lava" and "The wind").
 *
 * Both are the story's own, outside the simulation: the lava is a height the
 * director compares the player against, and a gust is a change to the
 * player's position between steps.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { StoryLava } from "@floor-fifty/shared/content/game-content";
import { STORY_RULES } from "./rules";

/** One phase's lava: where it starts, how fast it rises, and its grace. */
export class Lava {
  /** Ticks of rising so far, after the grace. */
  private risen = 0;
  private graceLeft: number;
  /** The mercy share: 1, or `mercyShare` after enough catches at one safe spot. */
  share = 1;

  constructor(
    readonly authored: StoryLava,
    /** The height it starts at: `startBelow` under its target floor. */
    private baseY: number,
  ) {
    this.graceLeft = authored.grace;
  }

  /** The lava's top now. */
  get y(): number {
    return this.baseY + (this.authored.rise * this.share * this.risen) / TICK_HZ;
  }

  /** This tick's pace: 1, or `lavaNearPace` while it is near the player's feet. */
  private pace = 1;

  /** Units a second it is rising now: 0 while its grace runs. */
  get rising(): number {
    return this.graceLeft > 0 ? 0 : this.authored.rise * this.share * this.pace;
  }

  /** One tick: its grace runs from the phase's first tick, then it rises; slower while `near` (the last stretch is a warning, not a trap). */
  tick(near = false): void {
    this.pace = near ? STORY_RULES.lavaNearPace : 1;
    if (this.graceLeft > 0) this.graceLeft -= 1;
    else this.risen += this.pace;
  }

  /** Brings it up to at least `y`, in its grace too: a chasing lava follows the player, so it stays on screen. */
  follow(y: number): void {
    if (this.y >= y) return;
    this.baseY += y - this.y;
  }

  /** Brings it down to at most `y`: a chasing lava backs off a falling player, so a fall costs time, never the climb. */
  sinkTo(y: number): void {
    if (this.y <= y) return;
    this.baseY -= this.y - y;
  }

  /** Back to `startBelow` under a floor, its grace again: after a catch. */
  reset(floorY: number): void {
    this.baseY = floorY - this.authored.startBelow;
    this.risen = 0;
    this.graceLeft = this.authored.grace;
  }
}

export type GustTick = {
  /** Units to move the player this tick (signed: right is positive). */
  readonly push: number;
  /** The direction of a gust that comes in `gustWarning` ticks, on the tick its warning starts. */
  readonly warning?: 1 | -1;
  /** The direction of a gust starting this tick. */
  readonly starts?: 1 | -1;
  /** The direction of the gust blowing now, or of the one being warned. */
  readonly blowing?: 1 | -1;
  readonly warned?: 1 | -1;
};

/** A phase's gusts: the first `gustFirst` ticks after the first input, then one every `gustEvery`, alternating right then left. */
export class Wind {
  private ticks = 0;

  constructor(readonly speed: number) {}

  /** The gust at a tick count: its index, and how far into it (negative before it starts). */
  private gustAt(ticks: number): { index: number; into: number } {
    const since = ticks - STORY_RULES.gustFirst;
    const index = Math.max(0, Math.floor((since + STORY_RULES.gustWarning) / STORY_RULES.gustEvery));
    return { index, into: since - index * STORY_RULES.gustEvery };
  }

  tick(going: boolean): GustTick {
    if (!going || this.speed <= 0) return { push: 0 };
    const now = this.ticks;
    this.ticks += 1;
    const { index, into } = this.gustAt(now);
    const direction: 1 | -1 = index % 2 === 0 ? 1 : -1;
    if (into === -STORY_RULES.gustWarning) return { push: 0, warning: direction, warned: direction };
    if (into < 0) return into > -STORY_RULES.gustWarning ? { push: 0, warned: direction } : { push: 0 };
    if (into < STORY_RULES.gustTicks)
      return { push: (direction * this.speed) / TICK_HZ, blowing: direction, ...(into === 0 ? { starts: direction } : {}) };
    return { push: 0 };
  }
}
