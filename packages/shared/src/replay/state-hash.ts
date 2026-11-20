/**
 * A replay's check: 32 bits of FNV-1a over what decides a race (race-options
 * spec §6.1), so the recorder and the viewer compare with one function.
 *
 * Every number is written as float64 bytes after `+ 0`, which folds -0 into 0.
 * The header crosses the wire as JSON, which writes -0 as 0, and a hash that
 * told them apart would call a race that never diverged a drift.
 */

import type { RaceState } from "../common/state";
import { isEndless } from "../simulation/endless";

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function stateHash(state: RaceState): number {
  const view = new DataView(new ArrayBuffer(8));
  let hash = OFFSET;
  const mix = (value: number): void => {
    view.setFloat64(0, value + 0);
    for (let i = 0; i < 8; i += 1) {
      hash ^= view.getUint8(i);
      hash = Math.imul(hash, PRIME);
    }
  };

  for (const id of Object.keys(state.players).sort(byId)) {
    const player = state.players[id as keyof typeof state.players]!;
    mix(player.x);
    mix(player.y);
    mix(player.vx);
    mix(player.vy);
    mix(player.lap);
    mix(player.bestFloor);
    mix(player.visitedFloorIds.length);
    // Survival's edge decides who is out; a finite race never reads it, so its hash is unchanged.
    if (isEndless(state.tuning)) {
      mix(player.floorEdgeY);
      mix(player.outAtTick ?? -1);
    }
  }
  if (isEndless(state.tuning)) mix(state.freedBelow);
  for (const id of Object.keys(state.movingFloors).sort(byId)) {
    const floor = state.movingFloors[id]!;
    mix(floor.x);
    mix(floor.direction);
  }
  return hash >>> 0;
}
