import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { resolveTuning } from "@floor-fifty/shared/common/tuning";
import { LOCAL_ID, snapshotAt } from "./snapshots";

export { LOCAL_ID };

export const tuning = resolveTuning();

/** An authority snapshot for `tick`, with the local player racing. */
export function racingSnapshot(tick: number, overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return snapshotAt(tick, overrides);
}
