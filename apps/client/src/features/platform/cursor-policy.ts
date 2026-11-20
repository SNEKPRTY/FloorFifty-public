/**
 * Whether the pointer is hidden (spec §3.1.3).
 *
 * Only in a race, only while not paused, and only when the player is not
 * using the mouse -- or has left it still for two seconds. Never on a menu:
 * a hidden cursor there is a lost player.
 */

import type { ScreenId } from "../profile/screen-state";

export const CURSOR_IDLE_MS = 2000;
export type CursorInput = "pointer" | "keyboard" | "gamepad" | "touch";

export function cursorHidden(state: {
  screen: ScreenId | undefined;
  paused: boolean;
  lastInput: CursorInput;
  msSincePointerMove: number;
}): boolean {
  if (state.screen !== "Gameplay" || state.paused) return false;
  return state.lastInput !== "pointer" || state.msSincePointerMove >= CURSOR_IDLE_MS;
}

export class CursorRunner {
  private lastInput: CursorInput = "pointer";
  private movedAt: number;
  private readonly now: () => number;

  constructor(
    private readonly target: HTMLElement,
    private readonly options: { now?: () => number; screen?: () => ScreenId | undefined; paused?: () => boolean } = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.movedAt = this.now();
  }

  noteInput(input: CursorInput): void {
    this.lastInput = input;
    if (input === "pointer") this.movedAt = this.now();
  }

  attach(events: EventTarget = window): () => void {
    const onMove = (): void => this.noteInput("pointer");
    const onKey = (): void => this.noteInput("keyboard");
    events.addEventListener("pointermove", onMove);
    events.addEventListener("keydown", onKey);
    return () => {
      events.removeEventListener("pointermove", onMove);
      events.removeEventListener("keydown", onKey);
      this.target.style.cursor = "";
    };
  }

  tick(): void {
    const hidden = cursorHidden({
      screen: this.options.screen?.() ?? "Gameplay",
      paused: this.options.paused?.() ?? false,
      lastInput: this.lastInput,
      msSincePointerMove: this.now() - this.movedAt,
    });
    const next = hidden ? "none" : "";
    if (this.target.style.cursor !== next) this.target.style.cursor = next;
  }
}
