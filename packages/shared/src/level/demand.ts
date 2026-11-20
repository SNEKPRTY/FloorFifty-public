/**
 * How much of one bounce each step of a course asks for
 * (docs/art/exceptional-race-slice-review.md, "How the seed was chosen").
 *
 * 0 is a floor straight overhead; 1 is a step no player can make. Pure: a
 * course and a tuning in, numbers out.
 */

import { VIEWPORT } from "../common/constants";
import { shortestWrappedOffset } from "../common/math";
import type { ResolvedTuning } from "../common/tuning";
import type { Course } from "./course";

export function bounceBudget(tuning: ResolvedTuning): number {
  const airborneSeconds = tuning.BOUNCE_VELOCITY / Math.abs(tuning.GRAVITY);
  return tuning.MAX_MOVE_SPEED * airborneSeconds + (tuning.FLOOR_WIDTH + tuning.PLAYER_WIDTH) / 2;
}

export function stepDemands(course: Course, tuning: ResolvedTuning): number[] {
  const budget = bounceBudget(tuning);
  const demands: number[] = [];
  for (let index = 1; index < course.floors.length; index += 1) {
    const dx = shortestWrappedOffset(course.floors[index - 1]!.x, course.floors[index]!.x, VIEWPORT.width);
    demands.push(Math.abs(dx) / budget);
  }
  return demands;
}
