/**
 * The four player colours, in seat order.
 *
 * A player's colour is theirs: one of these four, one each per room, chosen
 * on their seat (stage, song and character select spec §6.7), and drawn
 * everywhere they are: the racer, the cursor, the roster, the results. A
 * character is a body worn in that colour, never a colour of its own (§4.4),
 * so this list is shared by the content compiler, the room and the client.
 * Its order is the order a joiner is given the first free colour in.
 */
export const SEAT_COLOURS = ["scarlet", "cyan", "gold", "violet"] as const;

export type SeatColour = (typeof SEAT_COLOURS)[number];

/**
 * The first colour not in `taken`, stepping on from `after` in seat-colour
 * order and wrapping (from the start without `after`), or none when every
 * other colour is held. A joiner gets `nextFreeColour(held)`; a swatch steps
 * with `nextFreeColour(othersHeld, own)`.
 */
export function nextFreeColour(taken: ReadonlySet<SeatColour>, after?: SeatColour): SeatColour | undefined {
  const start = after === undefined ? 0 : SEAT_COLOURS.indexOf(after) + 1;
  for (let step = 0; step < SEAT_COLOURS.length; step += 1) {
    const colour = SEAT_COLOURS[(start + step) % SEAT_COLOURS.length]!;
    if (colour === after) continue;
    if (!taken.has(colour)) return colour;
  }
  return undefined;
}
