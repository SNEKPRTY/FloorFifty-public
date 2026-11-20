/**
 * The main menu's parallax (launch polish spec §2.9 item 2).
 *
 * The menu is layered like the race -- sky, clouds, a far and a near city --
 * and the layers slide against each other: a slow ambient sway, plus a small
 * lean toward the pointer where there is one. Nearer layers move further,
 * which is what reads as depth. Pure: the caller supplies the ambient clock's
 * time and the pointer, so a frozen clock holds the menu still, and reduced
 * motion puts every layer at rest.
 */

export const MENU_PARALLAX = {
  /** How far the nearest layer sways, in logical units. */
  swayUnits: 6,
  /** How long one sway takes, in seconds. */
  swaySeconds: 24,
  /** How far the nearest layer leans toward a pointer at the frame's edge. */
  pointerUnits: 10,
  /** Each layer's share of the motion: far layers move less. */
  depth: { sky: 0.1, clouds: 0.25, far: 0.45, near: 1 },
} as const;

export type MenuLayer = keyof typeof MENU_PARALLAX.depth;
export type Offset = { x: number; y: number };

/**
 * Offsets per layer, in logical units.
 *
 * `pointer` is in [-1, 1] on each axis, measured from the canvas's centre, or
 * `undefined` with no pointer (touch, keyboard, or a pointer that left).
 */
export function menuParallax(
  seconds: number,
  pointer: Offset | undefined,
  reducedMotion: boolean,
): Record<MenuLayer, Offset> {
  const phase = (seconds / MENU_PARALLAX.swaySeconds) * Math.PI * 2;
  // A slow figure: mostly sideways, with a little lift, so the city drifts
  // rather than oscillating on one axis.
  const sway = reducedMotion
    ? { x: 0, y: 0 }
    : { x: Math.sin(phase) * MENU_PARALLAX.swayUnits, y: Math.sin(phase * 2) * MENU_PARALLAX.swayUnits * 0.25 };
  const lean =
    reducedMotion || pointer === undefined
      ? { x: 0, y: 0 }
      : { x: pointer.x * MENU_PARALLAX.pointerUnits, y: pointer.y * MENU_PARALLAX.pointerUnits * 0.5 };

  const offsets = {} as Record<MenuLayer, Offset>;
  for (const layer of Object.keys(MENU_PARALLAX.depth) as MenuLayer[]) {
    const depth = MENU_PARALLAX.depth[layer];
    offsets[layer] = { x: (sway.x + lean.x) * depth, y: (sway.y + lean.y) * depth };
  }
  return offsets;
}

/** How the device's tilt stands in for the pointer on a phone or tablet. */
export const MENU_TILT = {
  /** Degrees of tilt from where the device was held that reach the frame's edge. */
  rangeDegrees: 20,
  /** How far each reading moves the lean toward it: sensors jitter. */
  smoothing: 0.15,
  /** How far each reading moves the rest angle toward it, so a new grip re-centres. */
  recentre: 0.01,
} as const;

/** A device's tilt, as `deviceorientation` reports it, in degrees. */
export type Tilt = { beta: number; gamma: number };

/**
 * The tilt away from `rest`, as a pointer in [-1, 1] -- the same lean the
 * cursor gives on desktop.
 *
 * `screenAngle` is the screen's rotation (0, 90, 180 or 270): the sensor's
 * axes are fixed to the device, so a phone held sideways swaps them.
 */
export function tiltLean(tilt: Tilt, rest: Tilt, screenAngle: number): Offset {
  const dBeta = tilt.beta - rest.beta;
  const dGamma = tilt.gamma - rest.gamma;
  const angle = ((Math.round(screenAngle / 90) % 4) + 4) % 4;
  const [x, y] =
    angle === 1 ? [dBeta, -dGamma] : angle === 2 ? [-dGamma, -dBeta] : angle === 3 ? [-dBeta, dGamma] : [dGamma, dBeta];
  const clamp = (value: number): number => Math.max(-1, Math.min(1, value / MENU_TILT.rangeDegrees));
  return { x: clamp(x), y: clamp(y) };
}
