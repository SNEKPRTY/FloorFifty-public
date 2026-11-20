/**
 * Which one-time hints a race shows, and which is on screen now
 * (first-race spec parts 4 and 5).
 *
 * Pure, so the rules are tested without a screen. The HUD has one toast slot
 * under its top row, so a race gets one queue of hints and shows them one at a
 * time: the swipe coach and the rotate hint (which the player needs, and which
 * stay until dismissed) never share a race with the timed ones.
 */

export type RaceHintKind = "swipe" | "rotate" | "edge" | "floors" | "restart";

/**
 * How long a timed hint stays: from GO until this long after her first input,
 * then the next one in the queue. Presentation only, so not tuning: before her
 * first input a Survival edge waits and a climb has nothing moving, so reading
 * costs her nothing.
 */
export const RACE_HINT_MS = 6000;

/** The hints that stay until dismissed, or until she is out. */
const HELD: ReadonlySet<RaceHintKind> = new Set(["swipe", "rotate"]);

/**
 * The hints this race shows, in order.
 *
 * A replay shows none, and neither does a viewer with no seat: a watcher is
 * not the one being taught, and watching must not spend a flag she has yet to
 * see. The swipe coach has its race to itself; the others wait for her next one
 * rather than being lost.
 */
export function raceHints(race: {
  endless: boolean;
  replay: boolean;
  /** The viewer has a racer in this race. */
  seated: boolean;
  /** The swipe coach is due: touch, swipe steering, not yet seen. */
  coachDue: boolean;
  seen: { edgeLine: boolean; climbHints: boolean };
}): readonly RaceHintKind[] {
  if (race.replay || !race.seated) return [];
  if (race.coachDue) return ["swipe"];
  if (race.endless && !race.seen.edgeLine) return ["edge"];
  if (!race.endless && !race.seen.climbHints) return ["floors", "restart"];
  return ["rotate"];
}

/**
 * The hint on screen: the first until `RACE_HINT_MS` after her first input,
 * then the next, then none; none at all once she is out, which is when the
 * slot's room is wanted for "OUT!". `sinceFirstInputMs` is undefined before
 * her first input.
 */
export function currentHint(
  queue: readonly RaceHintKind[],
  sinceFirstInputMs: number | undefined,
  out: boolean,
): RaceHintKind | undefined {
  if (out) return undefined;
  const first = queue[0];
  if (first === undefined || HELD.has(first)) return first;
  const slot = sinceFirstInputMs === undefined ? 0 : Math.floor(sinceFirstInputMs / RACE_HINT_MS);
  return queue[slot];
}

/**
 * True once every timed hint in the queue has had its time: the moment the
 * device's flag is set. Never true for the held hints, which are spent by being
 * dismissed, nor before her first input.
 */
export function hintsSpent(queue: readonly RaceHintKind[], sinceFirstInputMs: number | undefined): boolean {
  const first = queue[0];
  if (first === undefined || HELD.has(first) || sinceFirstInputMs === undefined) return false;
  return sinceFirstInputMs >= queue.length * RACE_HINT_MS;
}
