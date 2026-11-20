/**
 * Every race room this process holds, so a drain can speak to each one
 * (release readiness §5.4) and the room cap can count them (§6.1).
 */

/** The slice of a room the drain needs; kept narrow so this file imports no room. */
export type DrainableRoom = { beginDrain(): void };

const rooms = new Set<DrainableRoom>();

export const liveRooms: ReadonlySet<DrainableRoom> = rooms;

export function registerRoom(room: DrainableRoom): void {
  rooms.add(room);
}

export function forgetRoom(room: DrainableRoom): void {
  rooms.delete(room);
}
