/**
 * The rules around a race: readiness, the countdown, the lap count, starting,
 * and starting over.
 *
 * Plain functions over `RaceState`, with no Colyseus, no clock and no I/O, so
 * every rule is tested by building a race and calling it. The room calls
 * these and then does the parts only it can: rebuilding the physics world,
 * publishing the new state, and choosing a new host from who is still seated.
 *
 * Two conventions:
 * - A rule that adjusts the race in progress mutates the race it is given,
 *   as the room's own state is mutated everywhere else.
 * - A rule that begins a race (`startRace`, `nextRace`) returns a new
 *   `RaceState` and leaves the old one alone.
 *
 * A command a player may not make throws `RoomCommandError`; the room's
 * `CommandLedger` turns that into the answer the player sees.
 */

import { DEFAULT_CLOCK_SECONDS, QUICK_MATCH_SEARCH_TICKS, QUICK_MATCH_START_TICKS } from "@floor-fifty/shared/common/constants";
import type { LapCount, PlayerId } from "@floor-fifty/shared/common/ids";
import type { RaceState } from "@floor-fifty/shared/common/state";
import { cloneRaceState, createPlayerState, createRaceState } from "@floor-fifty/shared/common/state";
import type { ModeContent } from "@floor-fifty/shared/content/game-content";
import { RoomCommandError } from "./room-errors";

/**
 * Before the race: the lobby, and only the lobby. From select on, a join or a
 * readiness change would change what everyone is choosing (select spec §5.1).
 */
export function isPreRace(race: Pick<RaceState, "phase">): boolean {
  return race.phase === "lobby";
}

/**
 * Whether the room takes input frames.
 *
 * From the countdown on, so a player holding a direction through GO moves on
 * the first racing tick exactly as they would locally; never in the lobby, and
 * never once the race has finished.
 */
export function acceptsInput(race: Pick<RaceState, "phase">): boolean {
  return race.phase === "countdown" || race.phase === "racing";
}

/** The racers a room waits on: connected people. A ghost is not connected; a CPU never makes anyone wait. */
function connectedRacers(race: RaceState) {
  return Object.values(race.players).filter((player) => player.status === "connected" && !player.cpu);
}

/**
 * Whether a lone racer in a public room is still inside the search clock
 * (quick-match spec D-Q2): the room is still looking for company. A racer who
 * was ready when the others left waits it out; pressing Race alone ends it.
 */
export function isSearching(race: RaceState): boolean {
  return (
    race.access === "public" &&
    isPreRace(race) &&
    connectedRacers(race).length === 1 &&
    race.soloFromTick !== undefined &&
    race.tick < race.soloFromTick
  );
}

/**
 * Keeps a public lobby's two clocks in step with who is connected
 * (quick-match spec §5.1). The room calls it before `evaluateReadiness`, on
 * every join, leave, drop, return and ready change, and once a tick.
 *
 * - Nobody connected: both clocks are cleared.
 * - One racer: the search clock is set when the room reaches one racer and kept
 *   while it stays one; the start clock is cleared.
 * - Two or more: the start clock is set when the count first reaches two and is
 *   not moved by a later join; the search clock is cleared. When it runs out,
 *   every connected seat is made ready.
 *
 * A ghost is not connected, so it counts toward neither. A private room, and
 * any phase but the lobby, hold no clock.
 */
export function evaluateQuickMatch(race: RaceState): void {
  if (race.access !== "public" || !isPreRace(race)) {
    delete race.startsAtTick;
    delete race.soloFromTick;
    return;
  }

  const connected = connectedRacers(race);
  if (connected.length === 0) {
    delete race.startsAtTick;
    delete race.soloFromTick;
    return;
  }
  if (connected.length === 1) {
    delete race.startsAtTick;
    race.soloFromTick ??= race.tick + QUICK_MATCH_SEARCH_TICKS;
    return;
  }

  delete race.soloFromTick;
  race.startsAtTick ??= race.tick + QUICK_MATCH_START_TICKS;
  if (race.tick >= race.startsAtTick) {
    for (const player of connected) player.ready = true;
  }
}

/**
 * Opens the select phase once every connected racer is ready. The room calls
 * `enterSelect` right after, which opens the first pick step.
 *
 * Only connected racers count. A racer who dropped cannot hold the room up,
 * and their readiness was cleared when they dropped. A room with nobody
 * connected never opens select. A lone racer in a public room waits for the
 * search clock first (`isSearching`). Leaving the lobby clears the clocks.
 */
export function evaluateReadiness(race: RaceState): void {
  if (!isPreRace(race)) return;

  const connected = connectedRacers(race);
  const allReady = connected.length > 0 && connected.every((player) => player.ready);
  if (!allReady || isSearching(race)) return;

  race.phase = "select";
  delete race.startsAtTick;
  delete race.soloFromTick;
}

/** Whether a running countdown has reached zero on this tick. */
export function countdownElapsed(race: RaceState): boolean {
  return (
    race.phase === "countdown" &&
    race.countdownEndsAtTick !== undefined &&
    race.tick >= race.countdownEndsAtTick
  );
}

/**
 * The race as it begins: every racer back on the starting floor, still
 * carrying their connection status and readiness.
 *
 * The room must rebuild its physics world from the race this returns.
 */
export function startRace(race: RaceState): RaceState {
  const started = cloneRaceState(race);
  started.phase = "racing";
  started.raceStartedAtTick = started.tick;
  started.round = race.round + 1;
  delete started.countdownEndsAtTick;

  seatAtStart(started);
  return started;
}

/**
 * Puts every racer on the start floor as a fresh racer, keeping who they are:
 * their seat's status, readiness, character, colour and device. Used where the
 * countdown begins, so its snapshot already shows the racers where GO will
 * find them (race-flow spec §3.2), and again at GO.
 */
export function seatAtStart(race: RaceState): void {
  for (const player of Object.values(race.players)) {
    const fresh = createPlayerState(player.id, player.name, race.course, race.tuning);
    Object.assign(player, fresh, { status: player.status, ready: player.ready, characterId: player.characterId, colour: player.colour, deviceClass: player.deviceClass, cpu: player.cpu });
    delete player.holdUntilTick;
  }
}

/**
 * Who hosts next, from the seated players in seating order.
 *
 * The longest-seated player who is still connected, because a host who has
 * dropped cannot choose the laps and would block everyone who is there.
 * When nobody is connected, the longest-seated player, so a room always has
 * a host to hand on.
 */
export function nextHost(race: RaceState, seated: readonly PlayerId[]): PlayerId | undefined {
  return seated.find((playerId) => race.players[playerId]?.status === "connected") ?? seated[0];
}

/**
 * A player's Ready toggle. Refused once the race has begun. A lone racer's
 * Ready during the search is Race alone: it ends the search there and then.
 */
export function setReady(race: RaceState, playerId: PlayerId, ready: boolean): void {
  if (!isPreRace(race)) {
    throw new RoomCommandError("MALFORMED_MESSAGE", "readiness only changes before a race");
  }
  const player = race.players[playerId];
  if (player === undefined) {
    throw new RoomCommandError("INVALID_ROOM", "no such player in this room");
  }
  evaluateQuickMatch(race);
  if (ready && isSearching(race)) race.soloFromTick = race.tick;
  player.ready = ready;
  evaluateReadiness(race);
}

/**
 * The host's lap choice, in the lobby only.
 *
 * A guest is told they are not the host before anything else, so the lobby
 * can disable the control for the right reason rather than "not now".
 */
export function setLapCount(
  race: RaceState,
  playerId: PlayerId,
  lapCount: LapCount,
  offered: readonly LapCount[],
): void {
  if (playerId !== race.hostId) {
    throw new RoomCommandError("NOT_HOST", "only the host chooses the lap count");
  }
  if (race.phase !== "lobby") {
    throw new RoomCommandError("MALFORMED_MESSAGE", "the lap count only changes in the lobby");
  }
  if (!offered.includes(lapCount)) {
    throw new RoomCommandError("MALFORMED_MESSAGE", "this mode does not offer that lap count");
  }
  race.lapCount = lapCount;
}

/**
 * The host's Survival clock, in the lobby only (survival spec §5). The offer
 * is the room's mode's; a finite mode offers none, so it refuses every clock.
 */
export function setClock(race: RaceState, playerId: PlayerId, seconds: number, offered: readonly number[]): void {
  if (playerId !== race.hostId) {
    throw new RoomCommandError("NOT_HOST", "only the host chooses the clock");
  }
  if (race.phase !== "lobby") {
    throw new RoomCommandError("MALFORMED_MESSAGE", "the clock only changes in the lobby");
  }
  if (!offered.includes(seconds)) {
    throw new RoomCommandError("MALFORMED_MESSAGE", "this mode does not offer that clock");
  }
  race.clockSeconds = seconds;
}

/**
 * The host's race option, in the lobby only (race-options spec §3.2). A mode
 * that does not offer the current lap count drops it to one, so the ready
 * room never shows a choice the race cannot honour.
 */
export function setMode(
  race: RaceState,
  playerId: PlayerId,
  modeId: string,
  modes: readonly { readonly id: string; readonly laps: ModeContent["laps"]; readonly clocks?: ModeContent["clocks"] }[],
): void {
  if (playerId !== race.hostId) {
    throw new RoomCommandError("NOT_HOST", "only the host chooses the floors");
  }
  if (race.phase !== "lobby") {
    throw new RoomCommandError("MALFORMED_MESSAGE", "the floors only change in the lobby");
  }
  const mode = modes.find((entry) => entry.id === modeId);
  if (mode === undefined) {
    throw new RoomCommandError("MALFORMED_MESSAGE", "no such mode");
  }
  race.modeId = mode.id;
  if (!mode.laps.includes(race.lapCount)) race.lapCount = 1;
  // An unoffered clock falls back to the default, or to the mode's first when it does not offer that either.
  if (mode.clocks !== undefined && !mode.clocks.includes(race.clockSeconds)) {
    race.clockSeconds = mode.clocks.includes(DEFAULT_CLOCK_SECONDS) ? DEFAULT_CLOCK_SECONDS : mode.clocks[0]!;
  }
}

/**
 * A fresh lobby after a finished race, on the same course until the next
 * select chooses a stage, keeping every racer who is not a DNS. The room seed
 * is kept for the roulette, and `round` moves it on.
 *
 * A racer who dropped and is still inside their grace period comes over as a
 * ghost, on the same deadline. Rebuilt as connected, they would count as a
 * racer who is not ready, so the countdown could never start, and nothing
 * would ever expire them. The room clock carries on (`tick` is kept) so that
 * deadline stays meaningful.
 *
 * The host id is kept even when the host did not make the roster: the room
 * re-homes the host, because only the room knows who is still seated.
 *
 * Each racer keeps the body they raced in; readiness is cleared, so the ready
 * room is where they may change it.
 */
export function nextRace(race: RaceState): RaceState {
  if (race.phase !== "finished") {
    throw new RoomCommandError("MALFORMED_MESSAGE", "a race is still in progress");
  }

  // A public room's CPUs leave, so its free seats are offered to strangers
  // again (CPU players spec §3.2); a private room's stay, as a person would.
  const carried = Object.values(race.players).filter(
    (player) => player.status !== "dns" && !(player.cpu && race.access === "public"),
  );
  const roster = carried.map((player) => ({ id: player.id, name: player.name }));

  const next = createRaceState({
    seed: race.seed,
    roomSeed: race.roomSeed,
    lapCount: race.lapCount,
    modeId: race.modeId,
    clockSeconds: race.clockSeconds,
    tuning: race.tuning,
    access: race.access,
    players: roster,
  });
  if (race.stageId !== undefined) next.stageId = race.stageId;
  if (race.recentPicks !== undefined) next.recentPicks = race.recentPicks;
  next.tick = race.tick;
  next.hostId = race.hostId;
  next.round = race.round;
  for (const player of carried) {
    next.players[player.id]!.characterId = player.characterId;
    next.players[player.id]!.colour = player.colour;
    next.players[player.id]!.deviceClass = player.deviceClass;
    next.players[player.id]!.cpu = player.cpu;
    // A CPU is always ready; a person readies again in the ready room.
    next.players[player.id]!.ready = player.cpu;
  }
  for (const player of carried) {
    if (player.status !== "ghost") continue;
    const fresh = next.players[player.id]!;
    fresh.status = "ghost";
    if (player.ghostDeadlineTick !== undefined) fresh.ghostDeadlineTick = player.ghostDeadlineTick;
  }
  return next;
}
