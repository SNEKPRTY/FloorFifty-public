/**
 * The story's rule numbers (story mode v2 spec, "How it plays: the rules, with
 * numbers"), in one place. Each is the spec's, in simulation units and ticks
 * (60 a second); the authored ones -- lava speeds, wind speeds, safe spots,
 * floors -- live in `content/story.toml`, and the feel in `[story]` of
 * `content/juice.toml`.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import type { RaceState } from "@floor-fifty/shared/common/state";
import type { Floor } from "@floor-fifty/shared/level/course";

export const STORY_RULES = {
  /** A glim floats this far above the top of its floor. */
  glimHeight: 70,
  /** A racer's box grows by this much to pick a glim up. */
  glimReach: 14,
  /** A lamp opens under a landing at this share of fast-fall speed or more (`[slam] threshold`). */
  lampShare: 0.6,
  /** Two soft landings on shut lamps bring the "Harder!" line. */
  rattlesForHint: 2,
  /** "OUT!" stands this long before the climb starts again (`CAUGHT_TICKS`). */
  caughtTicks: Math.round(TICK_HZ * 1.5),
  /** From this many catches at one safe spot, the lava rises at `mercyShare` of its speed. */
  mercyAfter: 3,
  mercyShare: 0.8,
  /**
   * A chasing lava is never more than this far under the top of the floor
   * the player stands on or over (a little over a floor), its grace too:
   * it follows a fast climber, so its edge is in the lower part of even a
   * wide screen, which shows about 240 units under the racer before the
   * camera looks down (review R7; re-checks 3 and 4, R1). It is fair in return: it
   * backs off a fall (`lavaFallGap`) and slows near the player (`lavaNearPace`).
   */
  lavaLeash: 150,
  /** A falling player's feet are never nearer the chasing lava than this (one floor): it backs off, so the fall lands with the lava close and in sight, not in it. */
  lavaFallGap: 128,
  /** The lava is close within this many units of the player's feet, said every `lavaCloseEvery` ticks. */
  lavaClose: 140,
  lavaCloseEvery: 45,
  /** Within `lavaClose` of the feet a chasing lava rises at this share of its speed: kept close to be seen, it gives a slow climber time. */
  lavaNearPace: 0.5,
  /** The first gust comes this long after the phase's first input, then one every `gustEvery`, each `gustTicks` long. */
  gustFirst: 600,
  gustEvery: 480,
  gustTicks: 150,
  gustWarning: 60,
  /** A leashed actor holds once it is this many floors above the player. */
  leashAbove: 2,
  /** One this many floors below the player, for `catchUpTicks`, or under the lava, is put back near the player. */
  catchUpBelow: 3,
  catchUpTicks: 240,
  /** A leashed actor more than `leashAbove` floors above the player for this many ticks comes down to the floor above the player. */
  comeDownTicks: 60,
  /** A moving floor or a lamp is "seen" once it is within this many floors above the player. */
  seenFloors: 2,
  /** A line the director asks for again (the missing lamp) waits this long before asking again. */
  repeatTicks: 600,
} as const;

/** The top of a floor's walking surface. */
export const floorTop = (state: RaceState, floor: Floor): number => floor.y + state.tuning.FLOOR_HEIGHT / 2;

/** Where a racer stands on a floor: the y of its centre. */
export const standY = (state: RaceState, floor: Floor): number => floorTop(state, floor) + state.tuning.PLAYER_HEIGHT / 2;

/** The highest floor whose centre is at or below `y`: the floor a body there stands on or would land on. 0 below every floor. */
export function floorAt(state: RaceState, y: number): number {
  let under = 0;
  for (const floor of state.course.floors) if (floor.y <= y) under = Math.max(under, floor.index);
  return under;
}
