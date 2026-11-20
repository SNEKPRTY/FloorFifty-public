/**
 * Opaque identifiers.
 *
 * Branding keeps a room code, a player id, and a player-authored name from
 * being interchangeable at a call site, which is what stops an unvalidated
 * string from reaching the wire or a nameplate.
 */

export type PlayerId = string & { readonly __brand: "PlayerId" };
export type RoomId = string & { readonly __brand: "RoomId" };
export type PlayerName = string & { readonly __brand: "PlayerName" };
export type RaceEventId = string & { readonly __brand: "RaceEventId" };

/** The only lap counts a host may select. */
export type LapCount = 1 | 3;

export const asPlayerId = (value: string): PlayerId => value as PlayerId;
export const asRoomId = (value: string): RoomId => value as RoomId;

/**
 * Brands an already-validated name. Anything arriving from a client must go
 * through the schema in `common/schemas.ts` instead; this exists for server and
 * test code that constructs a name it already controls.
 */
export const asPlayerName = (value: string): PlayerName => value as PlayerName;

/**
 * Race event identity.
 *
 * Presentation de-duplicates events across snapshot replay and reconnect, so an
 * id must be derived from authoritative state and be identical for the same
 * event in two runs of the same tick.
 */
export const raceEventId = (
  tick: number,
  type: string,
  playerId: PlayerId,
  target: string,
): RaceEventId => `${tick}:${type}:${playerId}:${target}` as RaceEventId;
