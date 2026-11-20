/**
 * One CPU racer's hands (CPU players spec §4.1).
 *
 * The reference controller decides where to go; a personality decides how
 * well. Pure and deterministic: its only randomness is a stream seeded from
 * the room, so the same race always gets the same CPU, and the server's input
 * log -- not this file -- is what a replay reads.
 */

import type { PlayerId } from "../common/ids";
import type { HeldInput } from "../common/protocol";
import { SEAT_COLOURS, type SeatColour } from "../common/seats";
import { floorX, type PlayerState, type RaceState } from "../common/state";
import type { Floor } from "../level/course";
import { createRng, deriveSeed } from "../level/rng";
import { steerPlayer, targetFloor, wrappedOffset } from "../level/steering";
import { progressOf } from "../simulation/endless";
import { gapToBestPerson, moodScore, nextMood, type CpuMood } from "./mood";
import type { Personality } from "./personalities";
import { isEndless } from "../simulation/endless";

export type CpuController = {
  /** The frame to hold this tick, or undefined once the racer has left the race. */
  next(state: RaceState, sequence: number): HeldInput | undefined;
};

/** Salts the room's stream away from the roulette's (which uses 1-3). */
const CPU_STREAM = 16;

/** A CPU's stream for one race: by room, round and colour, so no two CPUs share one. */
export function cpuSeed(roomSeed: number, round: number, colour: SeatColour): number {
  return deriveSeed(deriveSeed(roomSeed, round), CPU_STREAM + SEAT_COLOURS.indexOf(colour));
}

type Hands = Pick<HeldInput, "left" | "right" | "fastFall">;
const HANDS_OFF: Hands = { left: false, right: false, fastFall: false };

/** Ahead of every other racer still in the race. Nobody else racing is not leading. */
function leading(state: RaceState, player: PlayerState): boolean {
  const score = (racer: PlayerState) => racer.lap + progressOf(state, racer);
  const others = Object.values(state.players).filter((other) => other.id !== player.id && other.status !== "dns");
  return others.length > 0 && others.every((other) => score(player) > score(other));
}

/**
 * Coasting (CPU banding spec §3): steer to stay over the floor last landed on,
 * bouncing in place, so a CPU that is cruising waits rather than drifting
 * under the next floor and stalling there.
 */
function coastOver(state: RaceState, player: PlayerState): Hands {
  const lastId = player.visitedFloorIds.at(-1);
  const floor = state.course.floors.find((candidate) => candidate.id === lastId);
  if (floor === undefined) return HANDS_OFF;
  const offset = wrappedOffset(player.x, floorX(state, floor));
  if (Math.abs(offset) <= COAST_WITHIN) return HANDS_OFF;
  return { left: offset < 0, right: offset > 0, fastFall: false };
}

/** How near a floor's centre counts as over it, for a coast: well inside any landing. */
const COAST_WITHIN = 6;

/** Wholly above the target floor's top face, as `steerPlayer` reckons it. */
function above(state: RaceState, player: PlayerState, target: Floor): boolean {
  return player.y - state.tuning.PLAYER_HEIGHT / 2 > target.y + state.tuning.FLOOR_HEIGHT / 2;
}

/**
 * Where this CPU stands against the best-placed person. The CPU is a CPU to
 * itself whatever its seat says, so a test's scripted rivals can be people.
 */
function moodOf(state: RaceState, playerId: PlayerId, previous: CpuMood): CpuMood {
  const endless = isEndless(state.tuning);
  const racers = Object.values(state.players).map((player) => ({
    id: player.id,
    cpu: player.id === playerId || player.cpu,
    status: player.status,
    score: moodScore({ lap: player.lap, progress: progressOf(state, player), bestFloor: player.bestFloor }, state.course.floorCount, endless),
  }));
  return nextMood(previous, gapToBestPerson(racers, playerId));
}

export function createCpuController(playerId: PlayerId, base: Personality, seed: number): CpuController {
  const rng = createRng(seed);
  let mood: CpuMood = "level";
  /** Decisions waiting out the reaction time, oldest first. */
  const pending: Hands[] = [];
  let lastVisited = -1;
  let stalledFor = 0;
  let targetId: string | undefined;
  let mishapFor = 0;
  let mishap: "slip" | "hold" | "coast" = "hold";

  return {
    next(state, sequence) {
      const player = state.players[playerId];
      if (player === undefined) return undefined;

      // The mood picks the knobs this tick drives with (CPU banding spec §3).
      mood = moodOf(state, playerId, mood);
      const personality: Personality = mood === "level" ? base : { ...base, ...base.bands[mood] };

      // A stall resets the ascent, as the reference controller's does; how
      // patient a CPU is before taking it is part of its personality.
      const visited = player.visitedFloorIds.length;
      if (visited !== lastVisited) {
        lastVisited = visited;
        stalledFor = 0;
      } else {
        stalledFor += 1;
      }
      if (stalledFor >= personality.stallTicks) {
        stalledFor = 0;
        pending.length = 0;
        mishapFor = 0;
        targetId = undefined;
        return { sequence, ...HANDS_OFF, reset: true };
      }

      // Each new target floor is one chance for the personality to show.
      const target = targetFloor(state, playerId);
      if (target !== undefined && target.id !== targetId) {
        targetId = target.id;
        if (target.kind === "moving" && personality.movingFloorPause > 0) {
          mishap = "hold";
          mishapFor = personality.movingFloorPause;
        } else if (rng.nextFloat() < personality.slipChance) {
          mishap = "slip";
          mishapFor = personality.slipTicks;
        } else if (personality.leadEase > 0 && (mood === "cruising" || leading(state, player)) && rng.nextFloat() < personality.leadEase) {
          // Cruising waits on its floor for the person to come; a level lead only lifts its hands.
          mishap = mood === "cruising" ? "coast" : "hold";
          mishapFor = personality.easeTicks;
        }
      }

      const steer = steerPlayer(state, playerId, sequence, { linedUpFraction: personality.linedUpFraction });
      let hands: Hands = steer === undefined ? HANDS_OFF : { left: steer.left, right: steer.right, fastFall: steer.fastFall };
      // Committing to a drop before lining up: quicker when it works, a miss when it does not.
      if (!hands.fastFall && personality.eagerDrop > 0 && target !== undefined && above(state, player, target) && rng.nextFloat() < personality.eagerDrop) {
        hands = { ...hands, fastFall: true };
      }
      if (mishapFor > 0) {
        mishapFor -= 1;
        hands =
          mishap === "hold" ? HANDS_OFF : mishap === "coast" ? coastOver(state, player) : { left: hands.right, right: hands.left, fastFall: false };
      }

      pending.push(hands);
      // Quicker hands in a mood drop the decisions now older than the reaction.
      while (pending.length > personality.reactionTicks + 1) pending.shift();
      const acted = pending.length > personality.reactionTicks ? pending.shift()! : HANDS_OFF;
      return { sequence, ...acted, reset: false };
    },
  };
}
