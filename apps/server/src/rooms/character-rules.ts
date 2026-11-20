/**
 * The ready room's character pick (stage, song and character select spec §5.2).
 *
 * Plain functions over `RaceState`, as `lobby-rules.ts` is: a rule mutates the
 * race it is given, and a pick a player may not make throws
 * `RoomCommandError`. A character is cosmetic, so none of this reaches the
 * simulation.
 */

import { DEFAULT_CHARACTER_ID, RANDOM_PICK } from "@floor-fifty/shared/common/constants";
import type { PlayerId } from "@floor-fifty/shared/common/ids";
import type { SeatColour } from "@floor-fifty/shared/common/seats";
import type { RaceState } from "@floor-fifty/shared/common/state";
import type { AccessSets } from "@floor-fifty/shared/content/access";
import { drawUniform, rouletteRng } from "@floor-fifty/shared/room/roulette";
import { RoomCommandError } from "./room-errors";

/** A seat's pick, in the lobby, while not ready. `"?"` is resolved when the race starts. */
export function pickCharacter(race: RaceState, playerId: PlayerId, choice: string, access: AccessSets): void {
  if (race.phase !== "lobby") {
    throw new RoomCommandError("MALFORMED_MESSAGE", "characters are picked in the ready room");
  }
  const player = race.players[playerId];
  if (player === undefined) throw new RoomCommandError("INVALID_ROOM", "no such player in this room");
  if (player.ready) throw new RoomCommandError("MALFORMED_MESSAGE", "Ready locks your character");
  if (choice !== RANDOM_PICK && !access.characters.includes(choice)) {
    throw new RoomCommandError("MALFORMED_MESSAGE", "that character is not yours to pick");
  }
  player.characterId = choice;
}

/** A player's colour, in the lobby, while not ready, and only one nobody else holds (select spec §6.7). */
export function pickColour(race: RaceState, playerId: PlayerId, colour: SeatColour): void {
  if (race.phase !== "lobby") {
    throw new RoomCommandError("MALFORMED_MESSAGE", "colours are picked in the ready room");
  }
  const player = race.players[playerId];
  if (player === undefined) throw new RoomCommandError("INVALID_ROOM", "no such player in this room");
  if (player.ready) throw new RoomCommandError("MALFORMED_MESSAGE", "Ready locks your colour");
  const held = Object.values(race.players).some((other) => other.id !== playerId && other.colour === colour);
  if (held) throw new RoomCommandError("MALFORMED_MESSAGE", "another player wears that colour");
  player.colour = colour;
}

/**
 * Keeps a seat inside its access after a new report: a body it no longer has
 * becomes the first it does, or the ninja. `"?"` stands.
 */
export function applyCharacterFallback(race: RaceState, playerId: PlayerId, access: AccessSets): void {
  const player = race.players[playerId];
  if (player === undefined || player.characterId === RANDOM_PICK) return;
  if (access.characters.includes(player.characterId)) return;
  player.characterId = access.characters[0] ?? DEFAULT_CHARACTER_ID;
}

/** Every `"?"` becomes a uniform draw from that seat's accessible characters, on the roulette's RNG. */
export function resolveRandomCharacters(race: RaceState, accessOf: (playerId: PlayerId) => AccessSets): void {
  // The room seed, never the course's: a stage's course seed is the same in every room.
  const rng = rouletteRng(race.roomSeed, race.round, "character");
  // Seat order by ID, so the draw order never depends on insertion order.
  const ids = (Object.keys(race.players) as PlayerId[]).sort();
  for (const id of ids) {
    const player = race.players[id]!;
    if (player.characterId !== RANDOM_PICK) continue;
    const pool = accessOf(id).characters;
    player.characterId = pool.length === 0 ? DEFAULT_CHARACTER_ID : drawUniform(rng, pool);
  }
}
