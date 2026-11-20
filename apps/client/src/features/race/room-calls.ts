/**
 * The ready room, heard: a racer joining is called by their colour, the way a
 * fighter is named at character select, and the countdown is called aloud.
 *
 * Read from snapshots like everything else in the room, and remembered per
 * mounting of the lobby: a racer already seated when this player arrived is not
 * news, and one who joins after is. The player's own arrival is announced too
 * -- hearing "Red!" is how a player learns which racer is theirs.
 */

import { TICK_MS } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { PlayerSnapshot, RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import { SEAT_CALLS } from "../../lib/constants";
import { countdownCues, type Cue } from "./race-cues";

/** The name follows the join flourish rather than landing on its transient. */
const NAME_AFTER_MS = 180;

export class RoomCalls {
  /** Everyone but the local player seen so far; undefined before the first look. */
  private seated: Set<PlayerId> | undefined;
  /** Whether this mounting has called the local player's own colour. */
  private localCalled = false;
  private countdown: number | undefined;
  constructor(private readonly localPlayerId: () => PlayerId | undefined) {}

  /**
   * Takes the snapshot on hand when the lobby opened, so racers already there
   * are not called as though they had just arrived. The local player is never
   * part of that baseline: they have just arrived, as far as their own ears go.
   */
  seed(snapshot: RoomSnapshot | undefined): void {
    if (snapshot === undefined) return;
    const local = this.localPlayerId();
    this.seated = new Set(snapshot.players.map((player) => player.id).filter((id) => id !== local));
    if (snapshot.phase === "countdown") this.countdown = snapshot.countdownEndsAtTick;
  }

  /** The sounds this snapshot asks for. */
  observe(snapshot: RoomSnapshot): readonly Cue[] {
    const cues: Cue[] = [];
    const call = (player: PlayerSnapshot): void => {
      const scarf = player.colour;
      // By tick too: a racer who leaves and comes back is called again.
      const id = `join:${player.id}:${snapshot.tick}`;
      cues.push({ alias: "ui.join", bus: "ui", eventId: `${id}/flourish` });
      cues.push({ alias: SEAT_CALLS[scarf], bus: "voice", eventId: `${id}/name`, delayMs: NAME_AFTER_MS });
    };

    // The local player's own colour, once their seat is known. Their ID can
    // land a snapshot or two after the room does, so it is checked every time
    // rather than only on the first look.
    const local = this.localPlayerId();
    const own = local === undefined ? undefined : snapshot.players.find((player) => player.id === local);
    // A seat's colour is given at the join (select spec §6.7), so the first
    // look already carries the colour to call.
    if (own !== undefined && !this.localCalled) {
      this.localCalled = true;
      call(own);
    }

    // Anyone else who sat down since the last look. The first look is the
    // baseline, not a roll call; and of several at once, the latest seat.
    // Nothing while the player's own seat is unknown, or their own arrival
    // could be announced as someone else's.
    const others = snapshot.players.filter((player) => player.id !== local);
    const seated = this.seated;
    const latest = others.filter((player) => !(seated?.has(player.id) ?? true)).at(-1);
    if (own !== undefined && latest !== undefined) call(latest);
    this.seated = new Set(others.map((player) => player.id));

    const endsAt = snapshot.countdownEndsAtTick;
    if (snapshot.phase === "countdown" && endsAt !== undefined && endsAt !== this.countdown) {
      this.countdown = endsAt;
      const remainingMs = Math.max(0, (endsAt - snapshot.tick) * TICK_MS);
      cues.push(...countdownCues(`countdown:${snapshot.hostId}:${endsAt}`, remainingMs));
    }
    if (snapshot.phase === "lobby") this.countdown = undefined;

    return cues;
  }
}
