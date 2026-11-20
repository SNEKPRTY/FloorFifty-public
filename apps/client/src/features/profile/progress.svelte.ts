/**
 * Load progress for a bar (launch polish §3.1.5): real fractions only, never
 * a timer, never backwards. Runes compile only in `.svelte.ts` files, which is
 * why these small state holders live here.
 */

export class MonotonicProgress {
  value = $state(0);

  /** Takes a fraction; clamps it into [0, 1] and ignores any step backwards. */
  report(fraction: number): void {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    if (clamped > this.value) this.value = clamped;
  }
}

/** Maps (load index, that load's fraction) to one bar across consecutive loads. */
export function weighted(parts: readonly number[]): (index: number, fraction: number) => number {
  const total = parts.reduce((sum, part) => sum + part, 0);
  return (index, fraction) => {
    const before = parts.slice(0, index).reduce((sum, part) => sum + part, 0);
    return (before + (parts[index] ?? 0) * Math.min(1, Math.max(0, fraction))) / total;
  };
}

/** Whether the splash's bundle is in, so the "tap to start" line can show. */
export class Readiness {
  ready = $state(false);
}
