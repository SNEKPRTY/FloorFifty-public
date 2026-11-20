/**
 * The rule behind each `unlocks.toml` ID (unlockables spec §4.1).
 *
 * The IDs are code-owned, as screens and events are: the content test refuses
 * an entry with no predicate here, and a predicate with no entry. `goal` in the
 * TOML is presentation; the thresholds here own the rule, and a test keeps the
 * two equal.
 *
 * Every predicate is pure over the race facts (what the results snapshot says)
 * and the device's own counts, so the client and the tests read one definition.
 *
 * Every condition is met by playing on one device, alone if need be: a match
 * against CPUs counts. The two that asked for a second human ("with-friend")
 * or a second kind of device ("two-devices") were retired for match counts,
 * all within ten; `LEGACY_CONDITIONS` carries what a device earned under them across.
 */
import type { DeviceClass, PlayerStatus, RoomPhase } from "../common/protocol";

export type RaceSeat = { id: string; status: PlayerStatus; deviceClass: DeviceClass; cpu: boolean };

export type RaceFacts = {
  phase: RoomPhase;
  localPlayerId: string | undefined;
  /** Every seat still in `players` at the finish. A seat removed outside a race is absent. */
  seats: readonly RaceSeat[];
};

export type ConditionFacts = {
  /** The race being judged, or none for a save or share. */
  race: RaceFacts | undefined;
  /** Including the race being judged, when it was a finished match. */
  matchesFinished: number;
  /** This device saved or shared a replay. */
  shared: boolean;
};

/** In D-U1 order, which is `unlocks.toml` order. */
export const CONDITION_IDS = [
  "any-match",
  "games-2",
  "share-replay",
  "games-3",
  "games-5",
  "games-7",
  "games-8",
  "games-10",
] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

/** Every count sits within ten matches: the whole set is a short evening's play. */
export const CONDITION_THRESHOLDS: Readonly<Partial<Record<ConditionId, number>>> = {
  "games-2": 2,
  "games-3": 3,
  "games-5": 5,
  "games-7": 7,
  "games-8": 8,
  "games-10": 10,
};

/**
 * Retired condition IDs, and the condition that took over their items. A
 * device that earned one keeps what it unlocked: the progress store reads the
 * old ID as the new one. `games-20` was Diver's before the ladder was cut to
 * ten matches.
 */
export const LEGACY_CONDITIONS: Readonly<Record<string, ConditionId>> = {
  "with-friend": "games-2",
  "two-devices": "games-3",
  "games-20": "games-8",
};

export function isConditionId(id: string): id is ConditionId {
  return (CONDITION_IDS as readonly string[]).includes(id);
}

/**
 * The local seat finished a match: the race reached `finished` (a race halted
 * with SIMULATION_FAILURE never does), and the seat is still in it and not a
 * DNS. Placing does not matter; a held ghost counts.
 */
export function finishedMatch(race: RaceFacts | undefined): boolean {
  if (race === undefined || race.phase !== "finished" || race.localPlayerId === undefined) return false;
  const local = race.seats.find((seat) => seat.id === race.localPlayerId);
  return local !== undefined && local.status !== "dns";
}

const games =
  (id: ConditionId) =>
  ({ matchesFinished }: ConditionFacts): boolean =>
    matchesFinished >= CONDITION_THRESHOLDS[id]!;

export const CONDITIONS: Readonly<Record<ConditionId, (facts: ConditionFacts) => boolean>> = {
  "any-match": ({ race }) => finishedMatch(race),
  "games-2": games("games-2"),
  "share-replay": ({ shared }) => shared,
  "games-3": games("games-3"),
  "games-5": games("games-5"),
  "games-7": games("games-7"),
  "games-8": games("games-8"),
  "games-10": games("games-10"),
};

/**
 * A race, once: the room's own seed and the races it has started. Not the
 * course `seed`, which is the stage's and repeats across rooms.
 */
export function raceKey(snapshot: { roomSeed: number; round: number }): string {
  return `${snapshot.roomSeed}:${snapshot.round}`;
}
