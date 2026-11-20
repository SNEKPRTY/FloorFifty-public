/**
 * How many rooms each address has open, by who created them (audit B1).
 *
 * Without it two addresses could hold every `MAX_ROOMS` slot for as long as
 * they liked. The count is taken and given back by the room itself, in
 * `onCreate` and `onDispose`, so a room that closes for any reason frees its
 * slot at once. Taking a slot is one synchronous step, so two creates that
 * arrive together cannot both pass a limit of one.
 */

const open = new Map<string, number>();

/** Counts one more room for `address`, or refuses when it already holds `limit`. */
export function claimRoomFor(address: string, limit: number): boolean {
  const held = open.get(address) ?? 0;
  if (held >= limit) return false;
  open.set(address, held + 1);
  return true;
}

/** Counts one room of `address` closed. An address with none open is forgotten. */
export function releaseRoomOf(address: string): void {
  const held = open.get(address);
  if (held === undefined) return;
  if (held <= 1) open.delete(address);
  else open.set(address, held - 1);
}

export function roomsOwnedBy(address: string): number {
  return open.get(address) ?? 0;
}
