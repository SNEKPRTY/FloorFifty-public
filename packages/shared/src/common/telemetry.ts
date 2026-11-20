/**
 * Measurement, without a clock.
 *
 * The server times its ticks and the client times its frames; both want the
 * same summary of a stream of numbers -- a median, a tail, a worst case -- and
 * both want it bounded, because a race runs for minutes and a telemetry buffer
 * that grows for as long as a room lives is a leak with a dashboard.
 *
 * Nothing here reads the time. It lives in the shared package because both
 * sides need it and neither should own it, and the shared package imports no
 * clock: whoever measures a duration passes the number in.
 */

export type DistributionSummary = {
  /** Samples currently in the window. */
  count: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p99: number;
  /** Every sample ever added, including those the window has since dropped. */
  lifetimeCount: number;
  /** The worst sample ever added. A spike is the thing a window must not forget. */
  lifetimeMax: number;
};

const EMPTY: DistributionSummary = {
  count: 0,
  mean: 0,
  min: 0,
  max: 0,
  p50: 0,
  p90: 0,
  p99: 0,
  lifetimeCount: 0,
  lifetimeMax: 0,
};

/** Nearest-rank percentile over an ascending array. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank]!;
}

/**
 * The newest `window` samples of a quantity, and two lifetime facts about all
 * of them.
 *
 * Percentiles are over the window, because "how is it now" is the question a
 * live overlay asks. The lifetime count and maximum survive eviction, because
 * "did it ever spike" is the question a report asks, and a window long enough
 * to answer it would be the unbounded buffer this avoids.
 */
export class Distribution {
  private readonly samples: number[] = [];
  private next = 0;
  private lifetime = 0;
  private worst = Number.NEGATIVE_INFINITY;

  constructor(private readonly window = 512) {
    if (!Number.isInteger(window) || window < 1) {
      throw new Error("a distribution needs a window of at least one sample");
    }
  }

  /** Records one sample. A non-finite value is a measurement bug, not data, and is ignored. */
  add(value: number): void {
    if (!Number.isFinite(value)) return;
    if (this.samples.length < this.window) {
      this.samples.push(value);
    } else {
      this.samples[this.next] = value;
    }
    this.next = (this.next + 1) % this.window;
    this.lifetime += 1;
    if (value > this.worst) this.worst = value;
  }

  get count(): number {
    return this.samples.length;
  }

  get lifetimeCount(): number {
    return this.lifetime;
  }

  get lifetimeMax(): number {
    return this.lifetime === 0 ? 0 : this.worst;
  }

  summary(): DistributionSummary {
    if (this.samples.length === 0) return { ...EMPTY, lifetimeCount: this.lifetime };
    const sorted = [...this.samples].sort((a, b) => a - b);
    let total = 0;
    for (const value of sorted) total += value;
    return {
      count: sorted.length,
      mean: total / sorted.length,
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      p99: percentile(sorted, 0.99),
      lifetimeCount: this.lifetime,
      lifetimeMax: this.lifetimeMax,
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.next = 0;
    this.lifetime = 0;
    this.worst = Number.NEGATIVE_INFINITY;
  }
}

/** One summary as a short line, for logs and overlays: `p50 1.2 p90 3.4 p99 5.6 max 7.8`. */
export function formatSummary(summary: DistributionSummary, digits = 1): string {
  const f = (value: number): string => value.toFixed(digits);
  return `p50 ${f(summary.p50)} p90 ${f(summary.p90)} p99 ${f(summary.p99)} max ${f(summary.lifetimeMax)}`;
}
