/**
 * A controller for the real built client.
 *
 * An init script replaces `navigator.getGamepads` with one standard-mapping
 * pad whose buttons and axes live on `window.__ffPad`; the helpers here write
 * them. Nothing reaches past the Gamepad API: the client's own poll, pad
 * reading, focus navigation and screens all run as they do for a real pad.
 * Connecting and unplugging dispatch `gamepadconnected` and
 * `gamepaddisconnected`, as a browser does. Every change waits three animation
 * frames, so the per-frame poll has read it before the helper returns -- except
 * the press inside a tap or a step, which waits one: a slow frame is long, and
 * three of them in WebKit under load outlasted the 400 ms repeat delay, turning
 * a tap into a held, repeating press. One is enough, because the client's poll
 * is registered for the next frame before the helper's own callback is.
 */

import { expect, type Page } from "@playwright/test";

export const PAD_BUTTONS = {
  south: 0,
  east: 1,
  west: 2,
  north: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  select: 8,
  start: 9,
  ls: 10,
  rs: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  home: 16,
} as const;
export type PadButton = keyof typeof PAD_BUTTONS;
export type PadMode = "dpad" | "stick";
export type Direction = "up" | "down" | "left" | "right";

type PadState = { buttons: number[]; axes: number[]; connected: boolean; timestamp: number };
/** The page-side pad and the `Gamepad`-shaped reading of it. */
type PadHost = { __ffPad: PadState; __ffPadSnapshot: () => unknown };
/** One change to the page-side pad; plain data, so it crosses into the page as JSON. */
type PadPatch = { connected?: boolean; button?: [number, number]; stick?: [number, number] };

const DPAD: Record<Direction, PadButton> = { up: "dpadUp", down: "dpadDown", left: "dpadLeft", right: "dpadRight" };
const STICK: Record<Direction, [number, number]> = { up: [0, -0.9], down: [0, 0.9], left: [-0.9, 0], right: [0.9, 0] };

export class FakePad {
  private constructor(private readonly page: Page) {}

  /** Installs the fake before any client script runs; call before `goto`. */
  static async install(page: Page): Promise<FakePad> {
    await page.addInitScript(() => {
      const state: PadState = { buttons: Array(17).fill(0), axes: [0, 0, 0, 0], connected: false, timestamp: 0 };
      const snapshot = () => ({
        id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)",
        index: 0,
        connected: true,
        mapping: "standard",
        timestamp: state.timestamp,
        axes: [...state.axes],
        buttons: state.buttons.map((value) => ({ pressed: value > 0.5, touched: value > 0, value })),
        vibrationActuator: null,
      });
      Object.assign(window as unknown as PadHost, { __ffPad: state, __ffPadSnapshot: snapshot });
      Object.defineProperty(Navigator.prototype, "getGamepads", {
        configurable: true,
        value: () => [state.connected ? snapshot() : null, null, null, null],
      });
    });
    return new FakePad(page);
  }

  async connect(): Promise<void> {
    await this.write({ connected: true });
  }

  async unplug(): Promise<void> {
    await this.write({ connected: false });
  }

  async press(button: PadButton, frames = 3): Promise<void> {
    await this.write({ button: [PAD_BUTTONS[button], 1] }, frames);
  }

  async release(button: PadButton): Promise<void> {
    await this.write({ button: [PAD_BUTTONS[button], 0] });
  }

  /** Press and release, held for one polled frame. */
  async tap(button: PadButton): Promise<void> {
    await this.press(button, 1);
    await this.release(button);
  }

  async stick(x: number, y: number, frames = 3): Promise<void> {
    await this.write({ stick: [x, y] }, frames);
  }

  /** Holds a direction on the d-pad or the stick. */
  async hold(direction: Direction, mode: PadMode, frames = 3): Promise<void> {
    if (mode === "dpad") await this.press(DPAD[direction], frames);
    else await this.stick(...STICK[direction], frames);
  }

  async letGo(direction: Direction, mode: PadMode): Promise<void> {
    if (mode === "dpad") await this.release(DPAD[direction]);
    else await this.stick(0, 0);
  }

  /** One step of a direction: held for one polled frame, then let go. */
  async step(direction: Direction, mode: PadMode): Promise<void> {
    await this.hold(direction, mode, 1);
    await this.letGo(direction, mode);
  }

  /**
   * Walks focus down until `testId` has it, asserting after every step that
   * focus is on something, visibly, and inside any open dialog.
   */
  async walkTo(testId: string, mode: PadMode, maxSteps = 40): Promise<void> {
    for (let steps = 0; steps <= maxSteps; steps += 1) {
      if ((await focusedTestId(this.page)) === testId) return;
      await this.step("down", mode);
      await expectFocusContained(this.page);
    }
    throw new Error(`the pad never reached ${testId} in ${maxSteps} steps (${mode})`);
  }

  /** Waits `count` animation frames, so the client's per-frame poll has run. */
  async frames(count = 3): Promise<void> {
    await this.page.evaluate(
      (n) =>
        new Promise<void>((resolve) => {
          let left = n;
          const tick = (): void => (--left <= 0 ? resolve() : void requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      count,
    );
  }

  private async write(patch: PadPatch, frames = 3): Promise<void> {
    await this.page.evaluate((change) => {
      const host = window as unknown as PadHost;
      const state = host.__ffPad;
      if (change.connected !== undefined && change.connected !== state.connected) {
        state.connected = change.connected;
        const type = change.connected ? "gamepadconnected" : "gamepaddisconnected";
        window.dispatchEvent(Object.assign(new Event(type), { gamepad: host.__ffPadSnapshot() }));
      }
      if (change.button !== undefined) state.buttons[change.button[0]] = change.button[1];
      if (change.stick !== undefined) [state.axes[0], state.axes[1]] = change.stick;
      state.timestamp = performance.now();
    }, patch);
    await this.frames(frames);
  }
}

export async function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset["testid"] ?? null);
}

/** Focus is on something, drawn as focused, and inside an open dialog if there is one. */
export async function expectFocusContained(page: Page): Promise<void> {
  const where = await page.evaluate(() => {
    const active = document.activeElement;
    const dialog = document.querySelector('[aria-modal="true"]');
    return {
      onBody: active === null || active === document.body,
      visible: active?.matches(":focus-visible") ?? false,
      inDialog: dialog === null || (active !== null && dialog.contains(active)),
    };
  });
  expect(where).toEqual({ onBody: false, visible: true, inDialog: true });
}

/**
 * The same, once the client has had its frame to put focus back: a screen
 * change removes the focused element, and focus is recovered on the next poll.
 */
export async function expectFocusSettled(page: Page): Promise<void> {
  await expect(async () => expectFocusContained(page)).toPass({ timeout: 5_000 });
}

/** The race's held intent via the test-only `__ffInput` hook, or null out of a race. */
export async function readInput(page: Page): Promise<{ left: boolean; right: boolean; fastFall: boolean } | null> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __ffInput?: () => { left: boolean; right: boolean; fastFall: boolean } })
      .__ffInput;
    return hook === undefined ? null : hook();
  });
}
