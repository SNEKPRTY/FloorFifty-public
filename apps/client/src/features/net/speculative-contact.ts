/**
 * The speculative contact cue.
 *
 * The slice's central question is whether authority and immediacy can coexist.
 * A landing is resolved by the server, and the answer arrives a round trip
 * later; the player saw their racer touch the floor at the moment it happened,
 * because their own client predicted it. Between those two moments there is
 * nothing, and nothing is what makes a visibly correct landing feel dead.
 *
 * So the local client may answer immediately, as long as it does not answer the
 * question authority is answering. What it plays is a tick and a compression:
 * "something happened here", with no claim about what. What it may never play
 * is anything that would be wrong if the server disagrees -- a score, a floor
 * credited, particles, a camera impulse, or any suggestion of a bonus. Those
 * wait for the confirmation, and the confirmation owns them.
 *
 * Three rules follow, and each is a test below:
 *
 * - **Confirmation upgrades, it does not repeat.** When the authoritative event
 *   arrives for a contact already ticked, the full landing sounds and the tick
 *   does not sound again. One landing is one impact, whatever the network did.
 * - **Silence cancels.** A prediction nothing confirms is dropped after a
 *   bounded wait, quietly. It never became anything a player would have to see
 *   taken back.
 * - **Only the local racer speculates.** A remote racer's position is already a
 *   report of something that happened; there is nothing to predict and nothing
 *   to be early about.
 *
 * Nothing here writes to `RaceState`, and nothing here is read by the
 * simulation.
 */

import { TICK_HZ } from "@floor-fifty/shared/common/constants";
import { MAX_LEAD_TICKS } from "./input-lead";

/**
 * How long a prediction may wait for the server to agree with it.
 *
 * Measured on the prediction's own tick, which runs up to `MAX_LEAD_TICKS`
 * ahead of authority so that inputs arrive on time; the confirmation then
 * still has a round trip to make. So the window is the largest lead plus the
 * half second a round trip was always given. Sized to the round trip alone, a
 * slow link expired a landing moments before the server agreed with it, and a
 * replay across that floor re-speculated it: one landing, heard twice. Still
 * short enough that a prediction the server rejected is forgotten before the
 * player could connect it to anything.
 */
export const CONFIRMATION_WINDOW_TICKS = MAX_LEAD_TICKS + Math.round(TICK_HZ * 0.5);

export type SpeculativeContact = {
  /** The floor the local prediction believes was touched. */
  readonly floorId: string;
  /** The predicted tick, which the server's own may differ from slightly. */
  readonly tick: number;
};

/** What the caller should do, which is always exactly one thing. */
export type ContactEffect =
  | { readonly kind: "speculate"; readonly floorId: string }
  | { readonly kind: "upgrade"; readonly floorId: string; readonly eventId: string }
  | { readonly kind: "confirm"; readonly floorId: string; readonly eventId: string }
  | { readonly kind: "cancel"; readonly floorId: string };

/**
 * Tracks predictions until authority agrees, disagrees, or says nothing.
 *
 * Deliberately not a queue of sounds. It decides *what kind* of thing should
 * happen and leaves the playing to the mixer and the drawing to the view, so
 * the rule about what a speculative cue may contain lives in one readable place
 * rather than spread across everything that reacts.
 */
export class SpeculativeContacts {
  private readonly pending = new Map<string, number>();

  /**
   * A local prediction touched a floor.
   *
   * Returns nothing when this floor is already pending: a wall ride touches the
   * same face on consecutive ticks, and each of those is the same contact
   * continuing rather than a new one to tick again.
   */
  predict(contact: SpeculativeContact): ContactEffect | undefined {
    if (this.pending.has(contact.floorId)) return undefined;
    this.pending.set(contact.floorId, contact.tick);
    return { kind: "speculate", floorId: contact.floorId };
  }

  /**
   * Authority confirmed a landing.
   *
   * `upgrade` where a prediction was already ticked -- the full landing sounds
   * and the tick does not sound again -- and `confirm` where none was, which is
   * the ordinary case for a landing the client never predicted. Both play the
   * landing; they differ in whether anything has already been heard, which is
   * what a caller needs to know to avoid doubling the transient.
   */
  confirm(floorId: string, eventId: string): ContactEffect {
    const predicted = this.pending.delete(floorId);
    return predicted
      ? { kind: "upgrade", floorId, eventId }
      : { kind: "confirm", floorId, eventId };
  }

  /**
   * Drops predictions nothing confirmed, and says which.
   *
   * Called every tick. A cancellation is silent by construction: the cue it
   * withdraws was a tick and a compression, both of which have already ended by
   * the time the window closes, so there is nothing to take back on screen.
   */
  expire(tick: number): readonly ContactEffect[] {
    const dropped: ContactEffect[] = [];
    for (const [floorId, at] of this.pending) {
      if (tick - at < CONFIRMATION_WINDOW_TICKS) continue;
      this.pending.delete(floorId);
      dropped.push({ kind: "cancel", floorId });
    }
    return dropped;
  }

  /** How many predictions are waiting. For tests and diagnostics. */
  get outstanding(): number {
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
  }
}
