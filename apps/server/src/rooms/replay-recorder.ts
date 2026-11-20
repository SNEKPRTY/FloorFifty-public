/**
 * Records the race a room runs, as a replay (race-options spec §6.2).
 *
 * Fed from `stepOnce` with the very values the step receives -- the state it
 * is handed and the map `InputQueue.take` produced -- so it cannot record
 * something the step did not see. A status the room set between ticks (a
 * drop, a return, a DNS) is found by comparing each racer's status before
 * this step with the one before the last: whatever set it, the step saw it.
 *
 * It holds at most one race. The input meter bounds its tracks, and a finite
 * course or the clock bounds its length.
 *
 * The input tracks are packed while the race runs (`InputTrack`) and become
 * `InputEntry` objects only when the replay is handed over. A CPU's sequence
 * moves every tick, so a four-seat race records about four entries a tick:
 * as objects that was roughly half a kilobyte a tick a room kept for the whole
 * race, in the old generation, for the collector to walk.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput, PlayerStatus } from "@floor-fifty/shared/common/protocol";
import type { RaceState } from "@floor-fifty/shared/common/state";
import {
  REPLAY_CHECK_TICKS,
  REPLAY_FORMAT,
  type InputEntry,
  type Replay,
  type ReplayCheck,
  type RoomEntry,
} from "@floor-fifty/shared/replay/replay";
import { stateHash } from "@floor-fifty/shared/replay/state-hash";

export type ReplayRevisions = { rulesetRevision: string; courseRevision: string; contentRevision: string };

const FLAG = { left: 1, right: 2, fastFall: 4, reset: 8, absent: 128 } as const;

const flagsOf = (frame: HeldInput): number =>
  (frame.left ? FLAG.left : 0) | (frame.right ? FLAG.right : 0) | (frame.fastFall ? FLAG.fastFall : 0) | (frame.reset ? FLAG.reset : 0);

/**
 * One seat's track, packed: per entry the tick it takes effect on, the
 * frame's sequence and a flag byte (the frame's four buttons, or absent for a
 * seat that left the input map). Ticks and sequences are kept as float64, so
 * every value round-trips exactly as the number it was.
 */
export class InputTrack {
  private ticks = new Float64Array(256);
  private sequences = new Float64Array(256);
  private flags = new Uint8Array(256);
  length = 0;

  /** Records `frame` from `tick` on, if it differs from the frame last recorded. Returns whether it did. */
  record(tick: number, frame: HeldInput | null): boolean {
    const last = this.length - 1;
    if (last >= 0) {
      const absent = (this.flags[last]! & FLAG.absent) !== 0;
      const same =
        frame === null
          ? absent
          : !absent && this.sequences[last] === frame.sequence && this.flags[last] === flagsOf(frame);
      if (same) return false;
    } else if (frame === null) {
      return false;
    }
    if (this.length === this.ticks.length) this.grow();
    this.ticks[this.length] = tick;
    this.sequences[this.length] = frame === null ? 0 : frame.sequence;
    this.flags[this.length] = frame === null ? FLAG.absent : flagsOf(frame);
    this.length += 1;
    return true;
  }

  /** The track as the replay format's entries. */
  entries(): InputEntry[] {
    const entries: InputEntry[] = new Array(this.length);
    for (let index = 0; index < this.length; index += 1) {
      const flags = this.flags[index]!;
      entries[index] = {
        tick: this.ticks[index]!,
        frame:
          (flags & FLAG.absent) !== 0
            ? null
            : {
                sequence: this.sequences[index]!,
                left: (flags & FLAG.left) !== 0,
                right: (flags & FLAG.right) !== 0,
                fastFall: (flags & FLAG.fastFall) !== 0,
                reset: (flags & FLAG.reset) !== 0,
              },
      };
    }
    return entries;
  }

  private grow(): void {
    const size = this.ticks.length * 2;
    const ticks = new Float64Array(size);
    ticks.set(this.ticks);
    const sequences = new Float64Array(size);
    sequences.set(this.sequences);
    const flags = new Uint8Array(size);
    flags.set(this.flags);
    this.ticks = ticks;
    this.sequences = sequences;
    this.flags = flags;
  }
}

type Recording = {
  replay: Omit<Replay, "finalTick" | "finalHash" | "inputs">;
  /** Each seat's frames, in `header.seats` order. */
  tracks: InputTrack[];
  statuses: Map<PlayerId, PlayerStatus>;
};

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const inputsOf = (recording: Recording): Record<PlayerId, InputEntry[]> =>
  Object.fromEntries(
    recording.replay.header.seats.map((seat, index) => [seat, recording.tracks[index]!.entries()]),
  ) as Record<PlayerId, InputEntry[]>;

export class ReplayRecorder {
  private recording: Recording | undefined;

  /** Begins at GO, from the state the room rebuilt its world around. */
  start(go: RaceState, revisions: ReplayRevisions): void {
    const seats = (Object.keys(go.players) as PlayerId[]).sort(byId);
    const { course: _course, ...state } = go;
    this.recording = {
      replay: {
        header: {
          format: REPLAY_FORMAT,
          ...revisions,
          stageId: go.stageId ?? "",
          songId: go.songId,
          modeId: go.modeId,
          lapCount: go.lapCount,
          seats,
          go: structuredClone(state),
        },
        room: [] as RoomEntry[],
        checks: [] as ReplayCheck[],
      },
      tracks: seats.map(() => new InputTrack()),
      statuses: new Map(seats.map((seat) => [seat, go.players[seat]!.status])),
    };
  }

  /** What the step on `state.tick` is about to see: the room's status changes, then the frames. */
  beforeStep(state: RaceState, inputs: ReadonlyMap<PlayerId, HeldInput>): void {
    const recording = this.recording;
    if (recording === undefined) return;
    const seats = recording.replay.header.seats;
    for (const seat of seats) {
      const status = state.players[seat]?.status;
      if (status !== undefined && status !== recording.statuses.get(seat)) {
        recording.replay.room.push({ tick: state.tick, playerId: seat, status });
        recording.statuses.set(seat, status);
      }
    }
    for (let index = 0; index < seats.length; index += 1) {
      recording.tracks[index]!.record(state.tick, inputs.get(seats[index]!) ?? null);
    }
  }

  /** Takes the check when one is due, and returns the finished replay on the finish tick only. */
  afterStep(state: RaceState): Replay | undefined {
    const recording = this.recording;
    if (recording === undefined) return undefined;
    if ((state.tick - recording.replay.header.go.tick + 1) % REPLAY_CHECK_TICKS === 0) {
      recording.replay.checks.push({ tick: state.tick, hash: stateHash(state) });
    }
    if (state.phase !== "finished") return undefined;
    this.recording = undefined;
    const { header, room, checks } = recording.replay;
    return { header, inputs: inputsOf(recording), room, checks, finalTick: state.tick, finalHash: stateHash(state) };
  }

  /** Forgets the race in progress: a halted race and race again keep nothing. */
  clear(): void {
    this.recording = undefined;
  }

  /** The tracks so far, for tests. */
  snapshot(): Pick<Replay, "inputs" | "room"> | undefined {
    if (this.recording === undefined) return undefined;
    return { inputs: inputsOf(this.recording), room: this.recording.replay.room };
  }
}
