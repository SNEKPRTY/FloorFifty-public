/**
 * The race's announcements (race-flow spec §6).
 *
 * The lines a screen reader hears from the HUD's one polite region, worked out
 * from snapshot transitions and events. Pure, so it is tested without the DOM.
 */

import * as m from "../../paraglide/messages.js";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { PlayerStatus, RoomPhase, RoomSnapshot } from "@floor-fifty/shared/common/protocol";

/**
 * What the race's polite live region says (race-flow spec §6): its phase and
 * status changes, never the timer, floors, progress or the count. Each line is
 * said once, keyed by event ID or by the change it names, so a replayed batch
 * says nothing. Each line is worded in the locale active when it happens; a
 * language switch re-says nothing.
 */
export class RaceAnnouncer {
  private readonly heard = new Set<string>();
  private phase: RoomPhase | undefined;
  private readonly statuses = new Map<string, PlayerStatus>();

  /**
   * `localId` is the viewer's own racer, so the line for her going out says
   * why (the lava caught her) where it names everyone else. A replay passes
   * nothing and names every racer. A function is read at each update, for a
   * seat that is only known after the screen opens (a reload).
   */
  constructor(private readonly localId?: PlayerId | (() => PlayerId | undefined)) {}

  observe(snapshot: RoomSnapshot): readonly string[] {
    const lines: string[] = [];
    const say = (key: string, line: string) => {
      if (this.heard.has(key)) return;
      this.heard.add(key);
      lines.push(line);
    };
    const name = (id: string) => snapshot.players.find((player) => player.id === id)?.name ?? m.race_a_racer();

    if (this.phase === "countdown" && snapshot.phase === "racing") say("go", m.race_go());
    // A Survival race that ends on its clock says "Time", once, before the
    // winner is named; one won by the last one standing does not (survival spec §4).
    // Read from the finish the race recorded, not this update's tick, which runs
    // on past it: a racer still standing at the end finished at the limit.
    const limit = snapshot.tuning.RACE_TIME_LIMIT_TICKS;
    const onClock = limit > 0 && snapshot.players.some((player) => player.outAtTick === undefined && (player.finishedAtTick ?? -1) >= limit);
    if (this.phase === "racing" && snapshot.phase === "finished" && onClock) {
      say(`time:${snapshot.raceStartedAtTick ?? 0}`, m.race_time_up());
    }
    this.phase = snapshot.phase;

    for (const event of snapshot.events) {
      if (event.type === "lapCompleted") {
        say(event.id, m.race_lap_completed({ name: name(event.playerId), lap: event.lap, laps: snapshot.lapCount }));
      }
      if (event.type === "raceFinished") say(event.id, m.race_finished_first({ name: name(event.winnerId) }));
      if (event.type === "playerOut") {
        const own = typeof this.localId === "function" ? this.localId() : this.localId;
        // The HUD's "OUT!" is silent for a screen reader, so this is the one
        // place she is told why (first-race spec part 3).
        say(event.id, event.playerId === own ? m.race_out_line() : m.race_player_out({ name: name(event.playerId) }));
      }
    }

    for (const player of snapshot.players) {
      const before = this.statuses.get(player.id);
      this.statuses.set(player.id, player.status);
      // A racer who went out and then left is out, not a DNS (survival spec §4).
      if (before !== undefined && before !== "dns" && player.status === "dns" && player.outAtTick === undefined) {
        say(`dns:${player.id}`, m.race_did_not_start({ name: player.name }));
      }
    }
    return lines;
  }
}
