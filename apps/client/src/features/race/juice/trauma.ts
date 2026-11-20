/**
 * Trauma shake (A/V polish plan, G2).
 *
 * The camera-shake model most action games now use: a trauma budget from 0 to
 * 1 that each impact adds to and time drains, and a shake that is the
 * *square* of it. Squaring is the point: a small knock stays a tremor, two
 * big ones stack into a jolt, and the shake dies away smoothly rather than
 * stopping. The motion is smooth noise rather than a random jump per frame:
 * here, three incommensurate sines per axis, so it is deterministic (the same
 * moment shakes the same in a replay) and never repeats visibly.
 *
 * Translation only, no turn: a turn would shimmer the pixel-snapped city and
 * carry the words off the racers they sit on.
 *
 * Presentation only, like the rest of the juice.
 */

export type ShakeTuning = {
  readonly maxUnits: number;
  readonly hz: number;
};

/** Each axis's noise: three sines at frequencies no two of which share a period. */
const AXES = {
  x: [1, 2.13, 3.71],
  y: [1.27, 2.61, 4.03],
} as const;
const PHASES = { x: 0, y: 1.7 } as const;

/** Summed sines in [-1, 1]. */
function noise(axis: keyof typeof AXES, t: number, hz: number): number {
  const ratios = AXES[axis];
  let sum = 0;
  for (const ratio of ratios) sum += Math.sin(2 * Math.PI * hz * ratio * t + PHASES[axis] * ratio);
  return sum / ratios.length;
}

export class Trauma {
  private value = 0;

  get level(): number {
    return this.value;
  }

  /** Adds a moment's share; trauma never passes one. */
  add(amount: number): void {
    this.value = Math.min(1, this.value + Math.max(0, amount));
  }

  /** Drains `decayPerSecond` a second, down to zero. */
  update(dtSeconds: number, decayPerSecond: number): void {
    this.value = Math.max(0, this.value - decayPerSecond * Math.max(0, dtSeconds));
  }

  /** The shake at time `t` seconds, in world units. */
  offset(t: number, tuning: ShakeTuning): { x: number; y: number } {
    const shake = this.value * this.value;
    if (shake === 0) return { x: 0, y: 0 };
    return {
      x: tuning.maxUnits * shake * noise("x", t, tuning.hz),
      y: tuning.maxUnits * shake * noise("y", t, tuning.hz),
    };
  }

  settle(): void {
    this.value = 0;
  }
}
