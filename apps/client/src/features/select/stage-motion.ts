/**
 * The Character page's stage in frames (select spec §6.1, amended again
 * 2026-09-30): which cell of a character sheet shows, how high above the
 * ledge, and for how long. Pure, so the timing is tested without a browser.
 *
 * A sheet is four frames across and one animation per row, in the
 * manifest's order, which `player-view.ts`'s `ANIMATION_ROWS` also reads.
 */

export const SHEET_ROWS = ["idle", "run", "jump", "fall", "land", "wall", "ceiling"] as const;
export type SheetAnimation = (typeof SHEET_ROWS)[number];

/** One frame's side in sheet pixels, and the sheet's grid. */
export const SHEET = { frame: 32, columns: 4, rows: SHEET_ROWS.length } as const;

export type StageMove = "drop" | "hop";

export type StageFrame = {
  readonly row: number;
  readonly column: number;
  /** Sheet pixels above the ledge, whole so the sprite never sits between pixels (motion.ts rule 1). */
  readonly lift: number;
  readonly ms: number;
  /** The dust puff under the feet, on a landing's first frame. */
  readonly dust?: true;
};

function at(animation: SheetAnimation, column: number, lift: number, ms: number, dust = false): StageFrame {
  const row = SHEET_ROWS.indexOf(animation);
  return dust ? { row, column, lift, ms, dust: true } : { row, column, lift, ms };
}

/** Idle's two frames at the manifest's 900 ms round. */
export const IDLE_FRAMES: readonly StageFrame[] = [at("idle", 0, 0, 450), at("idle", 1, 0, 450)];

/** Viewing: dropped in from a little above, landing with a puff. 350 ms. */
const DROP: readonly StageFrame[] = [
  at("fall", 0, 16, 60),
  at("fall", 0, 8, 60),
  at("fall", 0, 3, 50),
  at("land", 0, 0, 90, true),
  at("land", 1, 0, 90),
];

/** Picking: a victory hop, as long as the page waits before it closes. 500 ms. */
const HOP: readonly StageFrame[] = [
  at("jump", 0, 4, 60),
  at("jump", 0, 10, 80),
  at("jump", 0, 12, 70),
  at("fall", 0, 8, 60),
  at("fall", 0, 3, 50),
  at("land", 0, 0, 90, true),
  at("land", 1, 0, 90),
];

/** A move's frames, or none with reduced motion: the stage cuts to idle. */
export function sequence(move: StageMove, reduced: boolean): readonly StageFrame[] {
  if (reduced) return [];
  return move === "drop" ? DROP : HOP;
}
