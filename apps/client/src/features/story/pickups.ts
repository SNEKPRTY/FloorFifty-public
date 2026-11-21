/**
 * Glims and lamps (story mode v2 spec, "Glims" and "Lamps"), as pure state over
 * the race state. Only the player picks up; actors never do. A glim picked up
 * stays picked up through a catch and a retry.
 */

import type { PlayerState, RaceState } from "@floor-fifty/shared/common/state";
import { floorX } from "@floor-fifty/shared/common/state";
import { STORY_GLIMS_PER_LAMP, type StoryChapter } from "@floor-fifty/shared/content/game-content";
import { wrappedOffset } from "@floor-fifty/shared/level/steering";
import { STORY_RULES, floorTop } from "./rules";

export type GlimSpot = { readonly floor: number; readonly offset: number };

/** Where glim `glim` floats now: it rides its floor. */
export function glimPosition(state: RaceState, glim: GlimSpot): { x: number; y: number } {
  const floor = state.course.floors[glim.floor]!;
  return { x: floorX(state, floor) + glim.offset, y: floorTop(state, floor) + STORY_RULES.glimHeight };
}

/** Where lamp `index` (a floor) stands now: on its floor's middle. */
export function lampPosition(state: RaceState, floorIndex: number): { x: number; y: number } {
  const floor = state.course.floors[floorIndex]!;
  return { x: floorX(state, floor), y: floorTop(state, floor) };
}

/** Whether the player's box, grown by `glimReach`, touches a point. */
export function touches(state: RaceState, player: PlayerState, point: { x: number; y: number }): boolean {
  const halfW = state.tuning.PLAYER_WIDTH / 2 + STORY_RULES.glimReach;
  const halfH = state.tuning.PLAYER_HEIGHT / 2 + STORY_RULES.glimReach;
  return Math.abs(wrappedOffset(player.x, point.x)) <= halfW && Math.abs(player.y - point.y) <= halfH;
}

/** The glims a chapter holds: its loose ones and two in each lamp. */
export const chapterGlims = (chapter: Pick<StoryChapter, "glims" | "lamps">): number =>
  (chapter.glims ?? []).length + STORY_GLIMS_PER_LAMP * (chapter.lamps ?? []).length;

/** The fall speed at or past which a landing opens a lamp: `lampShare` of fast fall, a negative number. */
export const lampSpeed = (state: RaceState): number => STORY_RULES.lampShare * state.tuning.FAST_FALL_VELOCITY;

export type Pickups = {
  /** Loose glims taken, by index. */
  readonly taken: Set<number>;
  /** Lamps opened, by floor. */
  readonly open: Set<number>;
  /** Soft landings on shut lamps. */
  rattles: number;
};

export const freshPickups = (): Pickups => ({ taken: new Set(), open: new Set(), rattles: 0 });

/** Glims carried: loose ones taken, two for each open lamp. */
export const carried = (pickups: Pickups): number => pickups.taken.size + STORY_GLIMS_PER_LAMP * pickups.open.size;
