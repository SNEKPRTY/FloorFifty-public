/**
 * The story bot: what a skilled player would press this tick in a story
 * chapter. It climbs with the shared `steerPlayer`, picks up the glims on the
 * floor it stands on, opens the lamps, and dives by steering for the actor's
 * floor; it can be told to dawdle, to land soft, or to stop.
 *
 * Tests play chapters with it in Node, and an inspection build publishes its
 * advice on the live run (`window.__ffStory`) so a browser spec can play a
 * chapter on real keys, a pad or a finger. Never part of a production build:
 * the screen loads it only where visual inspection is on.
 */

import { floorX, type RaceState } from "@floor-fifty/shared/common/state";
import type { StoryChapter } from "@floor-fifty/shared/content/game-content";
import { steerPlayer, wrappedOffset } from "@floor-fifty/shared/level/steering";
import type { StoryRun } from "./story-run";
import { glimPosition } from "./pickups";

export type BotOptions = {
  /** In a lava phase, climb at this many ticks a floor: floor k of the phase is left no sooner than k of these after it starts. */
  readonly dawdleTicks?: number;
  /** Phases (by id) the dawdle applies to; all lava phases when absent. */
  readonly dawdlePhases?: readonly string[];
  /** In a lava phase, stop climbing: stay on the floor it is on. */
  readonly stopsInLava?: boolean;
  /** Never leave the floor it starts on (after the first press). */
  readonly stays?: boolean;
  /** Never fast fall: every landing is soft. */
  readonly soft?: boolean;
  /** Leave the glims where they are. */
  readonly skipGlims?: boolean;
  /** Ticks to give up after. */
  readonly maxTicks?: number;
};

export type BotIntent = { readonly left: boolean; readonly right: boolean; readonly fastFall: boolean; readonly reset: boolean };

const hands: BotIntent = { left: false, right: false, fastFall: false, reset: false };

/** Aims for an x on the player's own floor: a glim's, or the floor's middle. */
function aimAt(state: RaceState, playerId: string, x: number) {
  const player = state.players[playerId as keyof typeof state.players]!;
  const offset = wrappedOffset(player.x, x);
  return { ...hands, left: offset < -4, right: offset > 4 };
}

/**
 * One tick of going down to floor `to`: off the edge of the floor underfoot,
 * on the side toward the target, then over the target and fast.
 */
function dive(state: RaceState, playerId: string, from: number, to: number) {
  const player = state.players[playerId as keyof typeof state.players]!;
  const under = state.course.floors[from]!;
  const target = state.course.floors[to]!;
  const reach = (state.tuning.FLOOR_WIDTH + state.tuning.PLAYER_WIDTH) / 2;
  const underX = floorX(state, under);
  const targetX = floorX(state, target);
  const onUnder = Math.abs(wrappedOffset(player.x, underX)) < reach + 2;
  if (onUnder) {
    const side = wrappedOffset(underX, targetX) >= 0 ? 1 : -1;
    return { ...aimAt(state, playerId, underX + side * (reach + 14)), fastFall: false };
  }
  return { ...aimAt(state, playerId, targetX), fastFall: Math.abs(wrappedOffset(player.x, targetX)) < reach * 0.6 };
}

/** The bot's hands: called once a tick with the run as it stands, it says what to press. */
export function storyBot(chapter: StoryChapter, options: BotOptions = {}): (run: StoryRun, tick: number) => BotIntent {
  let intent: BotIntent = { ...hands };
  let lastFloor = -1;
  let lastPhase = "";
  let phaseStartTick = 0;
  let phaseStartFloor = 0;
  let released = false;
  return (run, tick) => {
    const director = run.director;
    const state = run.state;
    const playerId = run.playerId;
    const player = state.players[playerId]!;
    const floor = director.playerFloor;
    if (director.out) lastFloor = -1;
    if (director.phase.id !== lastPhase) {
      phaseStartTick = tick;
      phaseStartFloor = floor;
    }
    if (floor > lastFloor || director.phase.id !== lastPhase) {
      lastFloor = floor;
      lastPhase = director.phase.id;
      released = false;
    }
    const phase = director.phase;
    const inLava = phase.lava?.under === "player";
    const objective = director.objective;
    const here = state.course.floors[floor]!;
    const dawdles =
      inLava &&
      options.dawdleTicks !== undefined &&
      (options.dawdlePhases === undefined || options.dawdlePhases.includes(phase.id)) &&
      !released &&
      // On its schedule, so a floor gained by luck is paid back by a longer wait on the next.
      // It leaves on a fresh bounce, as a person would: never from the top of one.
      (tick < phaseStartTick + (floor - phaseStartFloor + 1) * options.dawdleTicks - 40 || player.vy < 200);
    if (!dawdles) released = true;

    // Where the bot wants to be: a glim's floor, a shut lamp's, the actor's, or up.
    const top = objective.kind === "reach" ? objective.floor : floor;
    const bottom = objective.kind === "rescue" ? objective.floor : 0;
    const glims = options.skipGlims
      ? []
      : (chapter.glims ?? []).flatMap((spot, index) =>
          director.pickups.taken.has(index) || spot.floor > top || spot.floor < bottom ? [] : [{ index, floor: spot.floor }],
        );
    const glimHere = glims.find((glim) => glim.floor === floor);
    const glimBelow = glims.filter((glim) => glim.floor < floor).sort((a, b) => b.floor - a.floor)[0];
    const lamp =
      objective.kind === "reach" && !options.soft && (objective.lampsNeeded > 0 || !options.skipGlims)
        ? (chapter.lamps ?? []).filter((each) => !director.pickups.open.has(each) && each < objective.floor).sort((a, b) => a - b)[0]
        : undefined;
    const downTo =
      glimHere !== undefined
        ? undefined
        : (glimBelow?.floor ?? (lamp !== undefined && lamp < floor ? lamp : objective.kind === "rescue" && objective.floor < floor ? objective.floor : undefined));

    if ((inLava && options.stopsInLava) || dawdles || options.stays) {
      intent = aimAt(state, playerId, floorX(state, here));
    } else if (glimHere !== undefined) {
      // Out to the glim while rising, back to the middle while falling, so the bounce stays on this floor.
      const at = glimPosition(state, chapter.glims![glimHere.index]!);
      intent = player.vy > 0 ? aimAt(state, playerId, at.x) : aimAt(state, playerId, floorX(state, here));
    } else if (downTo !== undefined) {
      intent = dive(state, playerId, floor, downTo);
    } else if (lamp === floor) {
      // On the lamp: bounce in the middle, and drop hard from the top of the bounce.
      intent = { ...aimAt(state, playerId, floorX(state, here)), fastFall: player.vy < 0 };
    } else {
      // Up: every floor to here counts as climbed, so the next to credit is the one above.
      const climbed = state.course.floors.slice(0, floor + 1).map((each) => each.id);
      const view = { ...state, players: { ...state.players, [playerId]: { ...player, visitedFloorIds: climbed } } };
      const steer = steerPlayer(view, playerId, tick);
      intent = steer === undefined ? { ...hands } : { ...hands, left: steer.left, right: steer.right, fastFall: steer.fastFall };
    }
    // A first press, even with nothing to steer for, starts the bounce.
    if (player.awaitingInput && !intent.left && !intent.right) intent = { ...intent, right: true };
    if (options.soft) intent = { ...intent, fastFall: false };

    return intent;
  };
}
