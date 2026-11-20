/**
 * CPU seats (CPU players spec §3).
 *
 * Plain functions over `RaceState`, as `lobby-rules.ts` is. A CPU is a player
 * with no client: always connected, always ready, never the host, never a
 * pick in select. The room owns the clients, so the room decides when a seat
 * is free of in-flight joins; these rules only ever see who is seated.
 */

import { DEFAULT_CHARACTER_ID, MAX_PLAYERS } from "@floor-fifty/shared/common/constants";
import { asPlayerName, type PlayerId } from "@floor-fifty/shared/common/ids";
import { SEAT_COLOURS } from "@floor-fifty/shared/common/seats";
import { createPlayerState, type RaceState } from "@floor-fifty/shared/common/state";
import { PERSONALITIES } from "@floor-fifty/shared/cpu/personalities";
import { createRng, deriveSeed } from "@floor-fifty/shared/level/rng";
import { drawUniform } from "@floor-fifty/shared/room/roulette";
import { isPreRace, isSearching } from "./lobby-rules";
import { RoomCommandError } from "./room-errors";

/** Salts the dressing stream away from the roulette's and the CPUs' driving. */
const DRESSING_STREAM = 32;

export const cpuCount = (race: RaceState): number => Object.values(race.players).filter((player) => player.cpu).length;

const humans = (race: RaceState) => Object.values(race.players).filter((player) => !player.cpu);

/** A stable number for a player id, so each CPU a room seats draws afresh. */
function idSalt(id: PlayerId): number {
  let salt = 0;
  for (const char of id) salt = (Math.imul(salt, 31) + char.charCodeAt(0)) >>> 0;
  return salt;
}

/**
 * Seats one CPU in a free colour drawn at random, named for that colour's
 * personality, and dressed at random from `characters` (the whole catalogue,
 * earned and paid alike). The draw is the room's: its seed, its round and the
 * CPU's own id, so adding a CPU again rolls again and a room's story repeats.
 */
export function seatCpu(race: RaceState, id: PlayerId, characters: readonly string[]): void {
  const held = new Set(Object.values(race.players).map((player) => player.colour));
  const free = SEAT_COLOURS.filter((colour) => !held.has(colour));
  if (free.length === 0 || Object.keys(race.players).length >= MAX_PLAYERS) {
    throw new RoomCommandError("ROOM_FULL", "every seat is taken");
  }
  const rng = createRng(deriveSeed(deriveSeed(deriveSeed(race.roomSeed, race.round), DRESSING_STREAM), idSalt(id)));
  const colour = drawUniform(rng, free);
  const player = createPlayerState(id, asPlayerName(PERSONALITIES[colour].name), race.course, race.tuning, colour, "desktop");
  player.characterId = characters.length === 0 ? DEFAULT_CHARACTER_ID : drawUniform(rng, characters);
  player.cpu = true;
  player.ready = true;
  race.players[id] = player;
}

/** The host's tap on an open seat: a private room's lobby only. Returns the CPU's id. */
export function addCpu(race: RaceState, by: PlayerId, allocateId: () => PlayerId, characters: readonly string[]): PlayerId {
  if (by !== race.hostId) throw new RoomCommandError("NOT_HOST", "only the host adds a CPU");
  if (!isPreRace(race)) throw new RoomCommandError("MALFORMED_MESSAGE", "CPUs are added in the ready room");
  if (race.access !== "private") throw new RoomCommandError("MALFORMED_MESSAGE", "a public room fills itself");
  if (Object.keys(race.players).length >= MAX_PLAYERS) throw new RoomCommandError("ROOM_FULL", "every seat is taken");
  const id = allocateId();
  seatCpu(race, id, characters);
  return id;
}

/** The host's tap on a CPU seat: frees it. */
export function removeCpu(race: RaceState, by: PlayerId, target: PlayerId): void {
  if (by !== race.hostId) throw new RoomCommandError("NOT_HOST", "only the host removes a CPU");
  if (!isPreRace(race)) throw new RoomCommandError("MALFORMED_MESSAGE", "CPUs are removed in the ready room");
  if (race.players[target]?.cpu !== true) throw new RoomCommandError("MALFORMED_MESSAGE", "that seat is not a CPU");
  delete race.players[target];
}

/** Every empty seat, a CPU each. Returns the new ids in seating order. */
export function fillCpus(race: RaceState, allocateId: () => PlayerId, characters: readonly string[]): PlayerId[] {
  const seated: PlayerId[] = [];
  while (Object.keys(race.players).length < MAX_PLAYERS) {
    const id = allocateId();
    seatCpu(race, id, characters);
    seated.push(id);
  }
  return seated;
}

/**
 * Whether `by`'s Ready is "Race CPUs" (spec D-C3): a public lobby where they
 * are the only person connected. The room fills before it applies the Ready.
 */
export function fillsOnReady(race: RaceState, by: PlayerId): boolean {
  if (race.access !== "public" || !isPreRace(race)) return false;
  const connected = humans(race).filter((player) => player.status === "connected");
  return connected.length === 1 && connected[0]!.id === by;
}

/**
 * Whether a public lobby is about to leave for select with seats still empty:
 * every person connected is ready and no search is running. Whatever route got
 * it there -- Race CPUs, the start clock, or company leaving a ready racer to
 * wait out the search -- a public race is never short (spec §9).
 */
export function leavesLobbyShort(race: RaceState): boolean {
  if (race.access !== "public" || !isPreRace(race) || Object.keys(race.players).length >= MAX_PLAYERS) return false;
  const connected = humans(race).filter((player) => player.status === "connected");
  return connected.length > 0 && connected.every((player) => player.ready) && !isSearching(race);
}

/** Whether a public lobby's start clock has run out: its empty seats fill before everyone is readied. */
export function startClockRanOut(race: RaceState): boolean {
  return race.access === "public" && isPreRace(race) && race.startsAtTick !== undefined && race.tick >= race.startsAtTick;
}
