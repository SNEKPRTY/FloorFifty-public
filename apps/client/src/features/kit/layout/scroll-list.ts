/**
 * ScrollList's arithmetic (UI layout system spec §5).
 *
 * A list reserves `minRows` before any sibling can take the height, so on a
 * short screen the actions shrink before a player's place disappears (audit
 * B1). Whatever is still out of view is counted, not left to be discovered.
 */

/** The rows to reserve: the minimum, or every row when there are fewer. */
export function reservedRows(minRows: number, rowCount: number): number {
  return Math.max(0, Math.min(minRows, rowCount));
}

/**
 * Rows wholly or partly below the visible area, from where the view ends
 * (`scrollTop + clientHeight`) and where each row ends, in the list's own
 * coordinates. Measured per row rather than as a count of equal rows, so a
 * taller row (the local racer's, with its badges) and the gaps between rows
 * are counted as they are. A row the edge cuts counts as hidden: a player
 * cannot read a half row. A row with no height (not laid out yet) is not.
 */
export function rowsBelow(viewBottom: number, rowBottoms: readonly number[]): number {
  return rowBottoms.filter((bottom) => bottom > 0 && bottom > viewBottom + 0.5).length;
}
