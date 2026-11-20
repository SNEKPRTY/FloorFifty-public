/**
 * A lit window's breath, off the GPU.
 *
 * The race's windows step along the warm ramp in the city shader
 * (`city-atmosphere.ts`). The menu's own building -- the facade under the
 * racers' ledge -- is DOM rather than canvas, so it cannot sit under that
 * shader; this is the same rule in TypeScript, so its windows keep the race's
 * rhythm: each at its own resting step, breathing on its own four-to-twelve
 * second period, lifted by the beat's glow, and now and then out for a moment.
 *
 * The menu's backdrop owns the clock and the song, so it publishes them here
 * (`publishMenuWindows`) and the facade reads them each frame. Nothing
 * published -- no backdrop, or one at `low` quality, where the race drops the
 * pass too -- and the facade's windows hold their plain amber.
 */

/** The ramp's steps, darkest first; `out` is a window gone dark for a moment. */
export type WindowStep = "dim" | "window" | "bright" | "hot" | "out";

/** How far a window's level rises per unit of glow; the shader's `GLOW_GAIN`. */
export const WINDOW_GLOW_GAIN = 0.3;

/** The shader's `hash`: a value in [0, 1) that depends only on `n`. */
function hash(n: number): number {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Which step window `id` (0-63) stands at, `seconds` into the clock, at `glow`. */
export function windowStep(id: number, seconds: number, glow: number): WindowStep {
  const phase = hash(id * 1.7 + 0.3);
  const base = hash(id * 3.1 + 1.9);
  const rate = 0.5 + phase;
  const out = (phase * 7 + seconds * 0.05) % 1;
  if (out < 0.08) return "out";
  const level = 0.2 + base * 0.6 + 0.2 * Math.sin(seconds * rate + phase * 2 * Math.PI) + glow * WINDOW_GLOW_GAIN;
  return level < 0.3 ? "dim" : level < 0.6 ? "window" : level < 0.85 ? "bright" : "hot";
}

/** What the menu's backdrop tells its building's windows each frame. */
export type MenuWindowLights = Readonly<{ seconds: number; glow: number }>;

let published: MenuWindowLights | undefined;

/** Set by the menu's backdrop each frame; undefined when it goes, or at `low`. */
export function publishMenuWindows(lights: MenuWindowLights | undefined): void {
  published = lights;
}

/** The menu's window clock and glow as last published; undefined holds them still. */
export function menuWindows(): MenuWindowLights | undefined {
  return published;
}
