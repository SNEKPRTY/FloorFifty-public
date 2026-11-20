/**
 * The loading moments a browser spec checks (Ruken loading plan, Task 11).
 *
 * "No screen appears before the assets it draws have arrived" cannot be seen
 * from outside: a screenshot says what is on screen, not whether its fonts
 * were in the instant it was uncovered. So the screens that matter say, at
 * the moment they show, what was true then, and the spec reads the list
 * (`window.__ffLoading`) against what the network actually delivered.
 *
 * Same three rules as the other inspection hooks (`inspection.ts`): off
 * unless asked for (`VITE_VISUAL_INSPECTION=1`, or `DEV`), it only reads, and
 * a production build exposes nothing at all.
 */

import { VISUAL_INSPECTION_ENABLED } from "../render/inspection";

export type LoadingMoment = Readonly<{
  /** `splash-shown`: its cover lifts. `menu-ready`: "Tap to start" is asked for. */
  name: "splash-shown" | "menu-ready";
  /** `Date.now()` at the moment, to set beside the network's own timings. */
  at: number;
  facts: Readonly<Record<string, boolean | number | string>>;
}>;

type Facts = LoadingMoment["facts"];

export function noteLoadingMoment(
  name: LoadingMoment["name"],
  facts: () => Facts,
  options: { enabled?: boolean; target?: Window } = {},
): void {
  if (!(options.enabled ?? VISUAL_INSPECTION_ENABLED)) return;
  const target = (options.target ?? window) as Window & { __ffLoading?: LoadingMoment[] };
  try {
    (target.__ffLoading ??= []).push({ name, at: Date.now(), facts: facts() });
  } catch {
    // A hook for tests never stops a screen.
  }
}
