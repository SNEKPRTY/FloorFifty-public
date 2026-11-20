/**
 * Squash and stretch on a spring (Wonder spec §4.2): a landing knocks the
 * racer's squash spring by an amount, x out and y in, and the spring settles
 * back to rest with its own wobble. Drawn on steps of 1/32, so the pixel art
 * keeps whole scales while the motion underneath keeps its overshoot. The
 * racer's sprite is anchored at its feet, so the face it lands on never moves.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { SpringTuning } from "@floor-fifty/shared/content/game-content";
import { SecondOrder, snapTo } from "../../../lib/second-order";

export type Scale = { readonly x: number; readonly y: number };

const REST: Scale = { x: 1, y: 1 };
/** The scale grid a squash is drawn on. */
const SCALE_STEP = 1 / 32;

/** Every racer's squash spring, at rest 0: the value is how far x is out and y is in. */
export class SquashBook {
  private readonly springs = new Map<PlayerId, SecondOrder>();

  constructor(private readonly spring: () => SpringTuning) {}

  /** Knocks a racer's squash to `amount`; a landing on one still settling re-knocks it, never past its amount. */
  knock(id: PlayerId, amount: number): void {
    let spring = this.springs.get(id);
    if (spring === undefined) {
      spring = new SecondOrder(this.spring());
      this.springs.set(id, spring);
    }
    spring.lift(amount);
  }

  /** Steps every squash toward rest, except the frozen racer's: hit-stop holds its pose. */
  update(dtSeconds: number, frozenId?: PlayerId): void {
    const tuning = this.spring();
    for (const [id, spring] of this.springs) {
      spring.retune(tuning);
      if (id !== frozenId) spring.update(dtSeconds, 0);
    }
  }

  /** A racer's scale as drawn. */
  scaleOf(id: PlayerId): Scale {
    const spring = this.springs.get(id);
    if (spring === undefined) return REST;
    return { x: snapTo(1 + spring.value, SCALE_STEP), y: snapTo(1 - spring.value, SCALE_STEP) };
  }

  /** Every racer at rest at once: reduced motion, a restart. */
  settle(): void {
    for (const spring of this.springs.values()) spring.set(0);
  }

  /** Squashes still moving. */
  get size(): number {
    let moving = 0;
    for (const spring of this.springs.values()) if (!spring.settled) moving += 1;
    return moving;
  }
}
