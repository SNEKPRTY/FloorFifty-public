/**
 * A replay of one race (race-options spec §6.1, D-O5).
 *
 * It is the state at GO, the inputs in force on each tick, and the status
 * changes the room made outside `step`. Re-simulated through the one
 * simulation there is, those reproduce the race exactly, so a replay records
 * nothing about presentation: the song, the characters and the stage are named
 * by ID and drawn from the viewer's own content.
 */

import type { LapCount, PlayerId } from "../common/ids";
import type { HeldInput, PlayerStatus } from "../common/protocol";
import type { RaceState } from "../common/state";

/** The layout's version; any change to the bytes moves it (`codec.ts`). */
export const REPLAY_FORMAT = 1;

/** A check is taken after every 60th step from GO. */
export const REPLAY_CHECK_TICKS = 60;

export type ReplayHeader = {
  format: typeof REPLAY_FORMAT;
  rulesetRevision: string;
  courseRevision: string;
  /** Informational: presentation can move without the race moving. */
  contentRevision: string;
  stageId: string;
  songId: string | undefined;
  modeId: string;
  lapCount: LapCount;
  /** Every seat at GO, sorted: the order the tracks are written in. */
  seats: PlayerId[];
  /** The whole state at GO, without the floors, which are rebuilt from its seed and tuning. */
  go: Omit<RaceState, "course">;
};

/** A frame now in force for a seat, or `null` when the seat left the input map. */
export type InputEntry = { tick: number; frame: HeldInput | null };

/** A status the room set outside `step`, in force from the step on `tick`. */
export type RoomEntry = { tick: number; playerId: PlayerId; status: PlayerStatus };

export type ReplayCheck = { tick: number; hash: number };

export type Replay = {
  header: ReplayHeader;
  inputs: Record<PlayerId, InputEntry[]>;
  room: RoomEntry[];
  checks: ReplayCheck[];
  finalTick: number;
  finalHash: number;
};
