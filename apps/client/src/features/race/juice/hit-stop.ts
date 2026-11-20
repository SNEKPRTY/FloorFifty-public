/**
 * The slam's hit-stop (polish spec §4.2, D-P5): the local racer's pose, its
 * squash and the camera follow freeze for a beat. Its position never does:
 * prediction and interpolation carry on underneath, so the racer is never
 * drawn somewhere authority disagrees with.
 */
export class HitStop {
  private fromMs = Number.POSITIVE_INFINITY;
  private untilMs = Number.NEGATIVE_INFINITY;

  /** Freezes from `nowMs` until `nowMs + ms`, never shortening a freeze already running. */
  start(nowMs: number, ms: number): void {
    if (!this.frozen(nowMs)) this.fromMs = nowMs;
    this.untilMs = Math.max(this.untilMs, nowMs + ms);
  }

  frozen(nowMs: number): boolean {
    return nowMs >= this.fromMs && nowMs < this.untilMs;
  }

  /** Ends any freeze at once: reduced motion switched on, or the scene leaving. */
  settle(): void {
    this.fromMs = Number.POSITIVE_INFINITY;
    this.untilMs = Number.NEGATIVE_INFINITY;
  }
}
