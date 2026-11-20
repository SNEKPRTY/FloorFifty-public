/**
 * Every tick's cost over one minute, across all rooms, for the minute's `ticks` log line.
 *
 * `Distribution` keeps its last 512 samples, which at 60 Hz and ten rooms is under a second,
 * so a minute's percentiles come from fixed buckets instead: 0.05 ms wide up to 50 ms, one
 * overflow bucket, and the exact max. A percentile is its bucket's upper edge, so at most
 * 0.05 ms high; one that lands in the overflow reports the max. Memory stays the same however
 * many rooms tick.
 */

export const BUCKET_MS = 0.05;
const BUCKETS = 1000; // 0 to 50 ms
const round = (ms: number): number => Math.round(ms * 1000) / 1000;

export type TickMinute = { n: number; p50: number; p90: number; p99: number; max: number };

export class TickHistogram {
  private readonly counts = new Uint32Array(BUCKETS + 1);
  private n = 0;
  private max = 0;

  add(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.counts[Math.min(BUCKETS, Math.floor(ms / BUCKET_MS))]! += 1;
    this.n += 1;
    if (ms > this.max) this.max = ms;
  }

  /** The minute so far, then a fresh minute. Undefined when no tick ran. */
  take(): TickMinute | undefined {
    if (this.n === 0) return undefined;
    const at = (q: number): number => {
      const rank = Math.ceil(q * this.n);
      let seen = 0;
      for (let i = 0; i < BUCKETS; i++) {
        seen += this.counts[i]!;
        if (seen >= rank) return round(Math.min((i + 1) * BUCKET_MS, this.max));
      }
      return round(this.max);
    };
    const minute = { n: this.n, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: round(this.max) };
    this.counts.fill(0);
    this.n = 0;
    this.max = 0;
    return minute;
  }
}
