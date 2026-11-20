/**
 * A CPU's mood (CPU banding spec §2): how it stands against the best-placed
 * person, which is what it bands toward.
 *
 * Pure, and read by both sides: the server's controller drives by it, and the
 * client pops a word when it changes. Both compute it from what they hold, so
 * the mood never crosses the wire and a replay stays exact.
 */

import type { PlayerStatus } from "../common/protocol";

export type CpuMood = "cruising" | "level" | "pushing";

/** One racer, as a mood sees it. `score` is in floors (`moodScore`). */
export type MoodRacer = {
  readonly id: string;
  readonly cpu: boolean;
  readonly status: PlayerStatus;
  readonly score: number;
};

/** Entered this far ahead (cruising) or behind (pushing), in floors. */
const ENTER = 4;
/** Left once the gap falls back inside this, so a mood never flickers at its edge. */
const LEAVE = 2;

/**
 * How far up a racer is, in floors: laps and this ascent's floors on a finite
 * course, the best floor on an endless one. The standings' own measure, from
 * fields the server and every snapshot both carry.
 */
export function moodScore(
  racer: { readonly lap: number; readonly progress: number; readonly bestFloor: number },
  floorCount: number,
  endless: boolean,
): number {
  if (endless) return racer.bestFloor;
  return (racer.lap - 1) * floorCount + Math.round(racer.progress * floorCount);
}

/**
 * A CPU's score less the best-placed person's. People are the racers who are
 * not CPUs and are still in the race; undefined when there are none.
 */
export function gapToBestPerson(racers: readonly MoodRacer[], cpuId: string): number | undefined {
  const cpu = racers.find((racer) => racer.id === cpuId);
  if (cpu === undefined) return undefined;
  let best: number | undefined;
  for (const racer of racers) {
    if (racer.cpu || racer.status === "dns") continue;
    best = best === undefined ? racer.score : Math.max(best, racer.score);
  }
  return best === undefined ? undefined : cpu.score - best;
}

/** The mood after `previous`, for this gap. Level with nobody to band toward. */
export function nextMood(previous: CpuMood, gap: number | undefined): CpuMood {
  if (gap === undefined) return "level";
  if (gap >= ENTER) return "cruising";
  if (gap <= -ENTER) return "pushing";
  if (previous === "cruising" && gap >= LEAVE) return "cruising";
  if (previous === "pushing" && gap <= -LEAVE) return "pushing";
  return "level";
}
