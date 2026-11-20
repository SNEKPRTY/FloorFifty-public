/**
 * The title's four racers (select spec §6.7): you in front, in your
 * remembered body and colour, then the last three players you saw in a room,
 * most recent first, as they were. A new player's empty places are ninjas in
 * the colours not yet stood there, as the lineup was before anyone was seen.
 */

import { SEAT_COLOURS, type SeatColour } from "@floor-fifty/shared/common/seats";
import type { SeenRacer } from "../profile/settings";
import { productionArt } from "../../lib/image-retry";

export type LineupRacer = { readonly characterId: string; readonly colour: SeatColour };

const PLACES = 4;

export function menuLineup(own: LineupRacer, seen: readonly SeenRacer[]): LineupRacer[] {
  const lineup: LineupRacer[] = [own, ...seen.slice(0, PLACES - 1).map(({ characterId, colour }) => ({ characterId, colour }))];
  for (const colour of SEAT_COLOURS) {
    if (lineup.length >= PLACES) break;
    if (!lineup.some((racer) => racer.colour === colour)) lineup.push({ characterId: "ninja", colour });
  }
  return lineup;
}

/**
 * The seen list after a room snapshot: the other players there now, in seat
 * order, ahead of those remembered from before, three at most. `undefined`
 * when nothing changed, so a snapshot stream does not rewrite storage.
 */
export function afterSeeing(
  seen: readonly SeenRacer[],
  others: readonly { id: string; characterId: string; colour: SeatColour }[],
): SeenRacer[] | undefined {
  const now = others.map(({ id, characterId, colour }) => ({ id, characterId, colour }));
  const next = [...now, ...seen.filter((racer) => !now.some((other) => other.id === racer.id))].slice(0, PLACES - 1);
  return JSON.stringify(next) === JSON.stringify(seen) ? undefined : next;
}

/** A racer's sprite sheet on the title, which draws its first frame; "?" stands as the ninja. */
export function lineupSheet(racer: LineupRacer): string {
  const body = racer.characterId === "?" ? "ninja" : racer.characterId;
  return productionArt(`${body}-${racer.colour}.png`);
}
