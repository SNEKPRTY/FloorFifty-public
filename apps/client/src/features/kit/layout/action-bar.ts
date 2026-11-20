import type { Snippet } from "svelte";

/**
 * The action bar's model (UI layout system spec §5).
 *
 * One row of actions that gives way in a fixed order as its container
 * narrows, so the primary action is the last thing to lose its words:
 *   0. every label in full;
 *   1. utility actions (Mute, Restart) drop to their icon;
 *   2. secondary actions take their short label;
 *   3. it wraps, with the primary alone on the first row.
 * Level 3 is a fallback. The screen contract (tests/e2e/support/contract.ts)
 * fails any SWEEP size where a bar reaches it.
 */

export type ActionKind = "primary" | "secondary" | "utility";

/**
 * A button's colour: green is the one step forward, red leaves or gives
 * something up, blue is everything else. A primary action is green and the
 * rest blue unless the action says otherwise.
 */
export type ActionTone = "go" | "stop" | "plain";

export interface BarAction {
  id: string;
  label: string;
  /** What a secondary action says from level 2 ("Replay" for "Watch replay"). */
  shortLabel?: string;
  /** A utility's icon; from level 1 the icon alone stands for it. */
  icon?: Snippet | undefined;
  kind: ActionKind;
  /** Overrides the colour its kind gives it (Leave is red, a replay's Back to results green). */
  tone?: ActionTone;
  /** Receives the click, so an action can act on its own button (Fullscreen blurs itself). */
  onSelect: (event: MouseEvent) => void;
  disabled?: boolean;
  /** A toggle's state, rendered as `aria-pressed` (Fullscreen). */
  pressed?: boolean;
  /** Rendered as `data-pad-guard`: a pad's A clicks it only when the pad walked there (focus-nav). */
  padGuard?: boolean;
  /** Rendered as `data-sfx`, the UI sound the delegated listener plays (ui-sounds.ts). */
  sfx?: string;
  /** Defaults to `id`, so existing e2e selectors keep working. */
  testId?: string;
}

export type CollapseLevel = 0 | 1 | 2 | 3;

/**
 * The first level whose one-row width fits. `widths` are the measured widths
 * of the bar laid out unwrapped at levels 0, 1 and 2.
 */
export function collapseLevel(available: number, widths: readonly [number, number, number]): CollapseLevel {
  if (widths[0] <= available) return 0;
  if (widths[1] <= available) return 1;
  if (widths[2] <= available) return 2;
  return 3;
}

/**
 * The default measurement: the bar's own width, and the natural width of each
 * hidden measuring row (`[data-measure="0|1|2"]`), which hold the same buttons
 * laid out unwrapped at that level.
 */
export function measureBar(bar: HTMLElement): { available: number; widths: [number, number, number] } {
  const row = (level: number): number =>
    bar.querySelector<HTMLElement>(`[data-measure="${level}"]`)?.scrollWidth ?? 0;
  return { available: bar.clientWidth, widths: [row(0), row(1), row(2)] };
}
