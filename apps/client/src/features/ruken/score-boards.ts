/**
 * The leaderboards Floor Fifty declares to Ruken (Ruken master plan M3.4,
 * M3 contracts §4.2): the one list `[leaderboards]` in `ruken.toml` is written
 * from (`deploy/tools/ruken-pack.ts`) and the race screen submits against
 * (`scores.ts`), so what the manifest says and what the game sends cannot drift.
 * The achievements Ruken shows players are declared here too, on those boards.
 *
 * Kept free of screen and message imports so the pack tool, which runs in
 * plain Node, can read it.
 */

export type ScoreBoard = {
  /** `asc`: the lowest score ranks first (a time). `desc`: the highest does (a floor). */
  readonly order: "asc" | "desc";
  /** Ruken refuses a score outside this range and never clamps it, so a cheat cannot reach the top. */
  readonly min: number;
  readonly max: number;
  /** What the score is, in Ruken's achievement rule lines. 1–48 characters. */
  readonly title?: string;
};

/** Survival's mode id (`content/modes/infinite.toml`): its runs feed the `survival` board. */
export const SURVIVAL_MODE_ID = "infinite";

/**
 * Boards by id. A time board's id is also the id of the mode whose races feed
 * it, in milliseconds. `survival` takes Survival's highest floor reached.
 *
 * `min` sits well under the fastest climb the physics allows (a bounce takes
 * about 0.85 s per floor: about 16 s for 20 floors, 42 s for 50), so no honest
 * time is refused, while a made-up one is. `max` is far beyond any climb worth
 * ranking.
 */
export const SCORE_BOARDS: Readonly<Record<string, ScoreBoard>> = {
  "floors-20": { order: "asc", min: 10_000, max: 20 * 60_000 },
  "floors-50": { order: "asc", min: 25_000, max: 50 * 60_000 },
  // The Owner's F1 decision (2026-10-27): a run posts the highest floor
  // reached, higher is better. A run that never clears floor 1 posts nothing.
  // At most 300 s on the clock, at about 0.85 s a floor, no run nears 1000.
  survival: { order: "desc", min: 1, max: 1000, title: "Highest floor" },
};

/** One of the game's achievements (Ruken M4.2 §8): exactly one rule, on a board above. */
export type Achievement = {
  /** 1–48 characters, plain text. */
  readonly title: string;
  /** 1–120 characters, plain text. */
  readonly description?: string;
  readonly board: string;
} & ({ readonly reach: number } | { readonly top_percent: 1 | 5 | 10 | 25 });

/** A kept achievement for reaching `floor` in a Survival run. */
const survivalFloor = (floor: number): Achievement => ({
  title: `Floor ${String(floor)} in Survival`,
  description: `Reach floor ${String(floor)} in a Survival run.`,
  board: "survival",
  reach: floor,
});

/**
 * Achievements by id (the Owner's F1 decision, 2026-10-27): kept ones for
 * reaching floors 10, 20, 35 and 50 in Survival, and one held for a best in
 * the top 10% of Survival. Ruken's playthrough asserts on `floors-20`.
 * Achievement ids are their own namespace: they share names with the time
 * boards but none of them is on one.
 */
export const ACHIEVEMENTS: Readonly<Record<string, Achievement>> = {
  "floors-10": survivalFloor(10),
  "floors-20": survivalFloor(20),
  "floors-35": survivalFloor(35),
  "floors-50": survivalFloor(50),
  "survival-top-10": {
    title: "Top 10% in Survival",
    description:
      "Hold a highest floor in the top tenth of everyone who plays Survival.",
    board: "survival",
    top_percent: 10,
  },
};
