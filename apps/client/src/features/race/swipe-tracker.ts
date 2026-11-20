/**
 * Swipe steering (spec §3.1.3), with no DOM in it.
 *
 * The simulation takes digital left and right, so the dead zone is the only
 * threshold that steers. The anchor starts where the thumb lands and trails
 * it at the saturation distance, so reversing after a long drag costs the same
 * short move as reversing from rest. Saturation is otherwise only what the
 * indicator draws.
 *
 * Only the first finger steers, but any finger may flick down to fast-fall, so
 * one thumb can hold a direction while the other flicks. A finger the surface
 * says may not steer (one that lands in the top half; Owner, 2026-10-10: any
 * downward flick slams, wherever it starts) only flicks, and leaves steering
 * to the next finger that may. Restart is the HUD timer's tap, not a gesture
 * here.
 */

export const SWIPE = {
  deadZonePx: 12,
  saturationPx: 48,
  flickPx: 40,
  flickMs: 180,
} as const;

export type SwipeAction = "left" | "right" | "fastFall";

type Pointer = { samples: { y: number; t: number }[] };

export class SwipeTracker {
  private readonly pointers = new Map<number, Pointer>();
  private steerer: number | undefined;
  private anchorX = 0;
  private thumbX = 0;
  private thumbY = 0;
  private direction: -1 | 0 | 1 = 0;

  constructor(
    private readonly emit: (action: SwipeAction, active: boolean) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Where the thumb indicator draws, or undefined while no finger steers. */
  get indicator(): { anchorX: number; thumbX: number; y: number; direction: -1 | 0 | 1 } | undefined {
    if (this.steerer === undefined) return undefined;
    return { anchorX: this.anchorX, thumbX: this.thumbX, y: this.thumbY, direction: this.direction };
  }

  /** A finger landed. The first one that may steer steers; every one may flick. */
  down(id: number, x: number, y: number, options: { steers?: boolean } = {}): void {
    this.pointers.set(id, { samples: [{ y, t: this.now() }] });
    if (this.steerer === undefined && options.steers !== false) {
      this.steerer = id;
      this.anchorX = x;
      this.thumbX = x;
      this.thumbY = y;
    }
  }

  /** A finger moved: look for a downward flick, and steer if it is the steerer. */
  move(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id);
    if (pointer === undefined) return;

    const t = this.now();
    pointer.samples.push({ y, t });
    pointer.samples = pointer.samples.filter((sample) => t - sample.t <= SWIPE.flickMs);
    const highest = Math.min(...pointer.samples.map((sample) => sample.y));
    if (y - highest >= SWIPE.flickPx) {
      this.emit("fastFall", true);
      this.emit("fastFall", false);
      pointer.samples = [{ y, t }];
    }

    if (id !== this.steerer) return;
    this.thumbX = x;
    this.thumbY = y;

    const s = SWIPE.saturationPx;
    if (x - this.anchorX > s) this.anchorX = x - s;
    else if (this.anchorX - x > s) this.anchorX = x + s;
    const dx = x - this.anchorX;
    this.setDirection(dx >= SWIPE.deadZonePx ? 1 : dx <= -SWIPE.deadZonePx ? -1 : 0);
  }

  /** A finger lifted: stop steering if it steered. */
  up(id: number): void {
    if (!this.pointers.delete(id)) return;
    if (id === this.steerer) {
      this.steerer = undefined;
      this.setDirection(0);
    }
  }

  /** The browser took the pointers (pointercancel, lost capture): release everything. */
  cancel(): void {
    this.pointers.clear();
    this.steerer = undefined;
    this.setDirection(0);
  }

  private setDirection(next: -1 | 0 | 1): void {
    if (next === this.direction) return;
    if (this.direction === -1) this.emit("left", false);
    if (this.direction === 1) this.emit("right", false);
    this.direction = next;
    if (next === -1) this.emit("left", true);
    if (next === 1) this.emit("right", true);
  }
}
