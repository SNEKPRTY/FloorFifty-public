/**
 * When each player's intent takes effect.
 *
 * A client stamps every frame with the tick it predicted the frame on, and
 * this holds the frame until the room reaches that tick. That is the whole of
 * input alignment: the client and the server apply the same intent on the same
 * tick, so the client's prediction and the room's authority step the same race
 * and agree to the bit, however long the frame spent on the wire -- provided it
 * arrived in time.
 *
 * It replaced a single slot per player that held whichever frame arrived last.
 * That applied intent on the tick it *arrived*, a round trip after the client
 * had already drawn it, and every input change became a correction: measured
 * at a hundred-millisecond round trip, the local racer was drawn thirty-five
 * units from where authority had them.
 *
 * Two rules keep a bad link from becoming a bad race. A frame that arrives
 * after its tick takes effect on the next tick the room steps: late, never
 * rewound, never refused for it. And frames consumed together -- a stall that
 * delivers a burst -- resolve to the newest, carrying any reset press among
 * them, so a burst cannot swallow a reset.
 *
 * No I/O and no clock: the room says what tick it is.
 */

import { MAX_INPUT_LEAD_TICKS, RECONNECT_GRACE_TICKS } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { HeldInput, InputFrame } from "@floor-fifty/shared/common/protocol";

/**
 * Frames one seat may have waiting.
 *
 * A client sends a frame only when its intent changes, and leads the room by
 * a round trip, so an honest queue holds a handful. Thirty-two is generous for
 * a hand on a keyboard and still a bound for a client that is not one.
 */
export const MAX_QUEUED_FRAMES = 32;

export type SubmitResult =
  | { ok: true; slack: number }
  | { ok: false; reason: "sequence" | "lead" | "full" };

type Seat = {
  /** Highest sequence accepted, kept across a disconnect so a reconnect continues it. */
  lastSequence: number;
  /** The effective tick of the newest accepted frame; later frames never precede it. */
  lastTick: number;
  /** Accepted frames not yet in force, in sequence order and so in tick order. */
  pending: { frame: InputFrame; tick: number }[];
  /** The frame in force, once one has been. */
  held: HeldInput | undefined;
};

export class InputQueue {
  private readonly seats = new Map<PlayerId, Seat>();

  private seat(playerId: PlayerId): Seat {
    let seat = this.seats.get(playerId);
    if (seat === undefined) {
      seat = { lastSequence: 0, lastTick: 0, pending: [], held: undefined };
      this.seats.set(playerId, seat);
    }
    return seat;
  }

  /**
   * Accepts one frame, given the last tick the room has stepped.
   *
   * `slack` is how many ticks early the frame arrived: its tick minus the next
   * tick the room will step. Zero is exactly in time; negative is late, and a
   * late frame takes effect on that next tick.
   */
  submit(playerId: PlayerId, frame: InputFrame, currentTick: number): SubmitResult {
    const seat = this.seat(playerId);
    if (frame.sequence <= seat.lastSequence) return { ok: false, reason: "sequence" };
    // A frame far ahead of the one authority holds is not a fast client, it is
    // a client that has lost track.
    if (frame.sequence > seat.lastSequence + RECONNECT_GRACE_TICKS) {
      return { ok: false, reason: "sequence" };
    }
    if (frame.tick > currentTick + MAX_INPUT_LEAD_TICKS) return { ok: false, reason: "lead" };
    if (seat.pending.length >= MAX_QUEUED_FRAMES) return { ok: false, reason: "full" };

    const due = currentTick + 1;
    // Sequence order is intent order, so a frame never takes effect before one
    // the client sent ahead of it, whatever tick it was stamped with.
    const tick = Math.max(frame.tick, due, seat.lastTick);
    seat.lastSequence = frame.sequence;
    seat.lastTick = tick;
    seat.pending.push({ frame, tick });
    return { ok: true, slack: frame.tick - due };
  }

  /**
   * The frame in force for each seat on `tick`.
   *
   * Called once per room tick, before the simulation steps. A seat with no
   * frame yet is absent from the map, which the simulation reads as neutral.
   */
  take(tick: number): Map<PlayerId, HeldInput> {
    const inForce = new Map<PlayerId, HeldInput>();
    for (const [playerId, seat] of this.seats) {
      let resetPressed = false;
      let consumed = false;
      while (seat.pending.length > 0 && seat.pending[0]!.tick <= tick) {
        const { frame } = seat.pending.shift()!;
        if (frame.reset) resetPressed = true;
        seat.held = {
          sequence: frame.sequence,
          left: frame.left,
          right: frame.right,
          fastFall: frame.fastFall,
          reset: frame.reset,
        };
        consumed = true;
      }
      if (seat.held === undefined) continue;
      // The carried press belongs to the tick it was consumed on. The held
      // frame itself is left as it was sent, and `applyInputs` fires a reset
      // only on a sequence it has not seen, so it cannot repeat.
      inForce.set(
        playerId,
        consumed && resetPressed && !seat.held.reset ? { ...seat.held, reset: true } : seat.held,
      );
    }
    return inForce;
  }

  /**
   * Puts a seat back at the sequence its racer acknowledged, for a page that
   * has reloaded (audit S13).
   *
   * The dropped page's numbering is not the new page's: the reloaded client
   * numbers on from the sequence the room acknowledged, which can be below the
   * last one accepted when frames were stamped ahead. Left alone, its first
   * frames were refused as old while what the dropped page had queued, and the
   * direction it was holding, went on applying. Frames at or below
   * `acknowledged` stay refused, so nothing is replayed.
   */
  resume(playerId: PlayerId, acknowledged: number): void {
    const seat = this.seat(playerId);
    seat.lastSequence = acknowledged;
    seat.lastTick = 0;
    seat.pending = [];
    seat.held = undefined;
  }

  /** Forgets a seat that has been given up, numbering and all. */
  forget(playerId: PlayerId): void {
    this.seats.delete(playerId);
  }

  /** Forgets every seat, as a new race does. */
  reset(): void {
    this.seats.clear();
  }
}
