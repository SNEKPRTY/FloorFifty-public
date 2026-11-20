/**
 * The CPUs' mood pops (CPU banding spec §4): one word over a CPU as it enters
 * a mood, in its own voice.
 *
 * Presentation only. The mood is the shared one (`cpu/mood.ts`), read off
 * each snapshot, so the word says what the server is already doing with that
 * CPU's hands. Koi, the benchmark, gives no tells. The first look at a room
 * says nothing: a CPU already ahead when a client arrives did not just get there.
 */

import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { RoomSnapshot } from "@floor-fifty/shared/common/protocol";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import { gapToBestPerson, moodScore, nextMood, type CpuMood } from "@floor-fifty/shared/cpu/mood";
import { isEndless } from "@floor-fifty/shared/simulation/endless";
import * as m from "../../../paraglide/messages.js";

/** How long a word stays, in milliseconds, over the racer and in the standings alike. */
export const BARK_MS = 1400;

export type CpuBark = { readonly id: PlayerId; readonly text: string; readonly colour: SeatColour };

/** Each seat colour's personality's words; Koi's seat (cyan) is silent. Resolved when said, so they follow a language switch. */
const WORDS: Readonly<Record<SeatColour, Readonly<Record<Exclude<CpuMood, "level">, () => string>> | undefined>> = {
  scarlet: { cruising: m.race_bark_blaze_cruising, pushing: m.race_bark_blaze_pushing },
  cyan: undefined,
  gold: { cruising: m.race_bark_sunny_cruising, pushing: m.race_bark_sunny_pushing },
  violet: { cruising: m.race_bark_moth_cruising, pushing: m.race_bark_moth_pushing },
};

export class CpuBarks {
  private readonly moods = new Map<PlayerId, CpuMood>();

  /** The words to pop for this snapshot: one per CPU that just entered a mood. */
  update(snapshot: RoomSnapshot): CpuBark[] {
    if (snapshot.phase !== "racing") {
      this.moods.clear();
      return [];
    }
    const endless = isEndless(snapshot.tuning);
    const racers = snapshot.players.map((player) => ({
      id: player.id,
      cpu: player.cpu,
      status: player.status,
      score: moodScore(player, snapshot.floorCount, endless),
    }));
    const barks: CpuBark[] = [];
    for (const player of snapshot.players) {
      if (!player.cpu) continue;
      const previous = this.moods.get(player.id);
      const mood = nextMood(previous ?? "level", gapToBestPerson(racers, player.id));
      this.moods.set(player.id, mood);
      if (previous === undefined || mood === previous || mood === "level") continue;
      const word = WORDS[player.colour]?.[mood];
      if (word !== undefined) barks.push({ id: player.id, text: word(), colour: player.colour });
    }
    return barks;
  }
}
