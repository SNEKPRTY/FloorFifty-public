import type { PadLike } from "../../../../apps/client/src/features/platform/gamepad-source";

/** A standard-mapping pad at rest. `press` and `stick` return a changed copy. */
export function fakePad(overrides: Partial<PadLike> = {}): PadLike & {
  press(button: number, value?: number): PadLike;
  stick(x: number, y: number): PadLike;
} {
  const base: PadLike = {
    id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)",
    index: 0,
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    ...overrides,
  };
  return {
    ...base,
    press: (button, value = 1) => ({
      ...base,
      buttons: base.buttons.map((entry, index) => (index === button ? { pressed: value > 0.5, value } : entry)),
    }),
    stick: (x, y) => ({ ...base, axes: [x, y, 0, 0] }),
  };
}
