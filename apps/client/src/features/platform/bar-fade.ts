/**
 * The letterbox bars' fade between the splash's true black and the palette's,
 * as numbers. It is stepped on the ticker (the bars are canvas), and a caller
 * that wants a screenshot reads "not done yet" from the canvas's
 * `data-bars-fade`, rather than guessing at a time.
 */
export type BarFade = { readonly from: number; readonly to: number; readonly elapsedMs: number; readonly ms: number };

export function startBarFade(from: number, to: number, ms: number): BarFade {
  return { from, to, elapsedMs: 0, ms };
}

export function stepBarFade(fade: BarFade, deltaMs: number): { fade: BarFade; value: number; done: boolean } {
  const elapsedMs = fade.elapsedMs + deltaMs;
  const t = Math.min(1, elapsedMs / fade.ms);
  return { fade: { ...fade, elapsedMs }, value: fade.from + (fade.to - fade.from) * t, done: t >= 1 };
}
