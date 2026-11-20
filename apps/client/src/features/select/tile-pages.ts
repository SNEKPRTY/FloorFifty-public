/**
 * The pages of the Character page's roster (stage, song and character
 * select spec §6.3), and the page arithmetic the fullscreen pickers share.
 *
 * A grid never scrolls: its items sit on pages of a fixed shape, one pack per
 * page, so no screen grows with the catalog. The shape is the most the spec
 * allows for the form factor, cut down to what the measured box can hold at
 * the smallest tile a finger can hit -- a form factor does not say how tall
 * a screen is (phone landscape is both 270 and 430 px tall).
 */

import type { SeatColour } from "@floor-fifty/shared/common/seats";

export type TileState = "open" | "locked" | "dlc";
export type TileItem = {
  id: string;
  label: string;
  state: TileState;
  art?: string | undefined;
  hint?: string | undefined;
  progress?: string | undefined;
  /** Earned by play and not yet revealed (unlockables spec §7.2). */
  isNew?: boolean | undefined;
};
export type PackGroup = { packId: string; title: string; items: readonly TileItem[] };
export type TilePage = { key: string; packId: string; title: string; slots: readonly (TileItem | undefined)[] };
export type Shape = { columns: number; rows: number };
/** A seat's cursor: `seat` 0..3 is drawn "P1".."P4", in the player's `colour` (select spec §6.7). */
export type Cursor = { itemId: string; seat: number; colour: SeatColour };

/** One pack per page; a pack longer than a page continues as "Title (2)". An empty pack has no page. */
export function paginate(groups: readonly PackGroup[], capacity: number): TilePage[] {
  const size = Math.max(1, capacity);
  const pages: TilePage[] = [];
  for (const group of groups) {
    for (let start = 0, part = 1; start < group.items.length; start += size, part += 1) {
      const items = group.items.slice(start, start + size);
      const slots: (TileItem | undefined)[] = [...items, ...Array.from({ length: size - items.length }, () => undefined)];
      pages.push({
        key: `${group.packId}:${part}`,
        packId: group.packId,
        title: part === 1 ? group.title : `${group.title} (${part})`,
        slots,
      });
    }
  }
  return pages;
}

const fits = (extent: number, minTile: number, gap: number): number =>
  Math.max(1, Math.floor((extent + gap) / (minTile + gap)));

/** The most tiles of `minTile` px the box holds, never more than the spec's `most`, never below one by one. */
export function fitShape(most: Shape, box: { width: number; height: number }, minTile: number, gap: number): Shape {
  return {
    columns: Math.max(1, Math.min(most.columns, fits(box.width, minTile, gap))),
    rows: Math.max(1, Math.min(most.rows, fits(box.height, minTile, gap))),
  };
}

/**
 * A square tile's side for the space a grid is given: the width shared by the
 * columns and the `peek` (a fraction of a tile) of the next page showing at
 * the edge, and the height only when the box has one -- a grid laid in a
 * content-sized panel passes `Infinity`, because a height measured from its
 * own tiles would only ever confirm the smallest tile. Clamped to
 * `min`..`max`.
 */
export function tileSide(
  shape: Shape,
  box: { width: number; height: number },
  gap: number,
  limits: { peek: number; min: number; max: number },
): number {
  const across = (box.width - gap * (shape.columns - 1)) / (shape.columns + limits.peek);
  const down = Number.isFinite(box.height) ? (box.height - gap * (shape.rows - 1)) / shape.rows : Infinity;
  return Math.max(limits.min, Math.min(limits.max, Math.floor(Math.min(across, down))));
}

/**
 * The chip side at which every pack fits stacked as a section, or `undefined`
 * when even the smallest chip does not fit: the roster then pages (select
 * spec §6.3). `extra` counts the chips before the first pack's items (the "?"
 * chip). `titleRow` is each section's chrome above its chips. Sections are
 * `gap` apart, as rows within a section are.
 */
export function stackedSide(
  groups: readonly PackGroup[],
  extra: number,
  columns: number,
  box: { width: number; height: number },
  gap: number,
  limits: { titleRow: number; min: number; max: number },
): number | undefined {
  const sections = groups.filter((group) => group.items.length > 0);
  if (sections.length === 0) return undefined;
  const rows = sections.reduce((sum, group, index) => sum + Math.ceil((group.items.length + (index === 0 ? extra : 0)) / columns), 0);
  const across = (box.width - gap * (columns - 1)) / columns;
  const fixed = sections.length * limits.titleRow + gap * (rows - 1);
  const down = (box.height - fixed) / rows;
  const side = Math.min(limits.max, Math.floor(Math.min(across, down)));
  return side >= limits.min ? side : undefined;
}

/** The shape cut to the rows the largest pack fills, so no page carries a row of empty slots. */
export function trimRows(shape: Shape, groups: readonly PackGroup[]): Shape {
  const largest = Math.max(0, ...groups.map((group) => group.items.length));
  return { columns: shape.columns, rows: Math.max(1, Math.min(shape.rows, Math.ceil(largest / shape.columns))) };
}

/** The page holding an item, or -1 when no page does. */
export function pageOf(pages: readonly TilePage[], itemId: string): number {
  return pages.findIndex((page) => page.slots.some((slot) => slot?.id === itemId));
}

export function wrapPage(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/**
 * The shape cut to the columns the largest pack fills, at its rows, so a short
 * roster does not leave a row of empty slots beside it (UI layout system
 * spec §6.6). Run after `trimRows`.
 */
export function fitColumns(shape: Shape, groups: readonly PackGroup[]): Shape {
  const largest = Math.max(0, ...groups.map((group) => group.items.length));
  return { columns: Math.max(1, Math.min(shape.columns, Math.ceil(largest / shape.rows))), rows: shape.rows };
}
