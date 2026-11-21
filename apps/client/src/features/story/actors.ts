/**
 * Frog and Oni (story mode v2 spec, "Actors"): one more racer each in the
 * story's race, flagged `cpu`, driven by the shared CPU controller with the
 * story's own personality, and held by the director's hands over it.
 *
 * - **Ceiling:** an actor never climbs past its ceiling floor, so none ever
 *   finishes the course.
 * - **Leash:** a leashed actor 2 floors or more above the player holds still
 *   (it bounces in place); one left more than 2 floors above for a second
 *   comes down to the floor above the player; one far below, or under the
 *   lava, is put back on the floor below the player.
 * - **Parked:** an actor that must stand still is held with `awaitingInput`,
 *   which the simulation already treats as standing on its floor.
 * - **Placed:** the director puts an actor on a floor by writing its position,
 *   speed and visited floors between steps.
 */

import { asPlayerId, type PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput } from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { floorX } from "@floor-fifty/shared/common/state";
import type { StoryActor, StoryChapterActor } from "@floor-fifty/shared/content/game-content";
import { createCpuController, cpuSeed, type CpuController } from "@floor-fifty/shared/cpu/controller";
import type { Personality } from "@floor-fifty/shared/cpu/personalities";
import { STORY_RULES, floorAt, standY } from "./rules";

export type ActorState = {
  readonly id: string;
  readonly playerId: PlayerId;
  ceiling: number;
  leash: boolean;
  parked: boolean;
  /** Ticks spent far below the player or under the lava, for the catch-up. */
  lostTicks: number;
  /** Ticks spent more than `leashAbove` floors above a leashed player, for the come-down. */
  highTicks: number;
  /** Standing still on a still floor, waiting for the player or at its ceiling. */
  waiting: boolean;
};

export const actorPlayerId = (actorId: string): PlayerId => asPlayerId(`actor-${actorId}`);

/** A story actor's personality as the controller takes it: named for its character, and never banding. */
export function personalityOf(actor: StoryActor, name: string): Personality {
  return { name, ...actor.personality, bands: { cruising: {}, pushing: {} } };
}

/**
 * Puts a racer on a floor: standing on it, still, with every floor up to it
 * credited, so the controller's next target is the floor above.
 */
export function placeOn(state: RaceState, playerId: PlayerId, floorIndex: number, parked: boolean): void {
  const player = state.players[playerId];
  const floor = state.course.floors[floorIndex];
  if (player === undefined || floor === undefined) return;
  player.x = floorX(state, floor);
  player.y = standY(state, floor);
  player.vx = 0;
  player.vy = parked ? 0 : state.tuning.BOUNCE_VELOCITY;
  player.grounded = true;
  player.awaitingInput = parked;
  player.visitedFloorIds = state.course.floors.slice(0, floorIndex + 1).map((each) => each.id);
}

export class Actors {
  readonly list: ActorState[];
  private readonly controllers = new Map<string, CpuController>();

  constructor(
    chapter: { readonly seed: number; readonly actors: readonly StoryChapterActor[] },
    content: Readonly<Record<string, StoryActor>>,
    names: (actorId: string) => string,
  ) {
    this.list = chapter.actors.map((actor) => ({
      id: actor.id,
      playerId: actorPlayerId(actor.id),
      ceiling: actor.ceiling,
      leash: actor.leash,
      parked: actor.parked === true,
      lostTicks: 0,
      highTicks: 0,
      waiting: false,
    }));
    for (const actor of this.list) {
      const authored = content[actor.id]!;
      this.controllers.set(
        actor.id,
        createCpuController(actor.playerId, personalityOf(authored, names(actor.id)), cpuSeed(chapter.seed, 0, authored.colour)),
      );
    }
  }

  find(actorId: string): ActorState | undefined {
    return this.list.find((actor) => actor.id === actorId);
  }

  /**
   * Each actor's input for the next tick. An actor at its ceiling or ahead of
   * a leashed player waits: once it stands on a still floor it stands there
   * (`awaitingInput`, as at a race's start), since even a hands-off bounce
   * can catch the floor above and lift it; on a moving floor it rides with
   * its hands off. The controller is not asked while it waits, so its stall
   * clock does not run.
   */
  inputs(state: RaceState, playerFloor: number, sequence: number): Map<PlayerId, HeldInput> {
    const frames = new Map<PlayerId, HeldInput>();
    for (const actor of this.list) {
      const racer = state.players[actor.playerId];
      if (racer === undefined) continue;
      const floorIndex = floorAt(state, racer.y);
      const floor = state.course.floors[floorIndex]!;
      const waits = floorIndex >= actor.ceiling || (actor.leash && floorIndex >= playerFloor + STORY_RULES.leashAbove);
      const standing = Math.abs(racer.y - standY(state, floor)) < 2 && racer.vy <= 0;
      if (actor.parked || (waits && floor.kind === "stationary" && (actor.waiting || standing))) {
        if (!actor.waiting && !actor.parked) placeOn(state, actor.playerId, floorIndex, true);
        actor.waiting = !actor.parked;
      } else if (actor.waiting) {
        actor.waiting = false;
        racer.awaitingInput = false;
        racer.vy = state.tuning.BOUNCE_VELOCITY;
      }
      const holds = actor.parked || actor.waiting || waits;
      const hands = holds ? undefined : this.controllers.get(actor.id)!.next(state, sequence);
      frames.set(actor.playerId, hands ?? { sequence, left: false, right: false, fastFall: false, reset: false });
    }
    return frames;
  }

  /**
   * After a step: parked actors stay parked, a leashed actor left far above
   * the player comes down (not in a dive, where the player leaves it on
   * purpose), and a leashed actor lost far
   * below the player or under the lava for long enough is put on the floor
   * below the player. Returns the actors it put back, for the spawn burst.
   */
  keep(state: RaceState, playerFloor: number, lavaY: number | undefined, diving: boolean): ActorState[] {
    const moved: ActorState[] = [];
    for (const actor of this.list) {
      const racer = state.players[actor.playerId];
      if (racer === undefined) continue;
      const floor = floorAt(state, racer.y);
      // Left far above (after the player fell, or dove), a leashed actor comes back down to them.
      actor.highTicks = actor.leash && !actor.parked && !diving && floor > playerFloor + STORY_RULES.leashAbove ? actor.highTicks + 1 : 0;
      if (actor.highTicks >= STORY_RULES.comeDownTicks) {
        actor.waiting = false;
        placeOn(state, actor.playerId, Math.min(playerFloor + 1, actor.ceiling), false);
        actor.highTicks = 0;
        actor.lostTicks = 0;
        moved.push(actor);
        continue;
      }
      if (actor.parked || actor.waiting) {
        racer.awaitingInput = true;
        actor.lostTicks = 0;
        continue;
      }
      const under = lavaY !== undefined && racer.y - state.tuning.PLAYER_HEIGHT / 2 < lavaY;
      const far = floor <= playerFloor - STORY_RULES.catchUpBelow;
      actor.lostTicks = (actor.leash && far) || under ? actor.lostTicks + 1 : 0;
      if (under || actor.lostTicks >= STORY_RULES.catchUpTicks) {
        // The floor below the player, unless the lava has it: then the player's own.
        const below = Math.max(0, playerFloor - 1);
        const safe = lavaY === undefined || standY(state, state.course.floors[below]!) - state.tuning.PLAYER_HEIGHT / 2 >= lavaY;
        placeOn(state, actor.playerId, safe ? below : playerFloor, false);
        actor.lostTicks = 0;
        moved.push(actor);
      }
    }
    return moved;
  }
}
