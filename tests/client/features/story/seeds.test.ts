/**
 * The story's five courses (story mode v2, U2): each chapter plays a course of
 * its own from `seed` on base tuning, chosen so what the chapter asks of the
 * player holds still. The stages' own seeds fail these rules, so a chapter
 * borrows only the stage's look and song.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { asPlayerName, asPlayerId } from "@floor-fifty/shared/common/ids";
import { createRaceState, type RaceState } from "@floor-fifty/shared/common/state";
import type { StoryChapter } from "@floor-fifty/shared/content/game-content";

const artifact = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../content/generated/content.json"), "utf8")) as {
  content: { baseTuning: RaceState["tuning"]; story: { chapters: StoryChapter[] } };
};
const chapters = artifact.content.story.chapters;

type Rule = {
  /** Floors that must hold still, beyond every lamp and safe spot the chapter names. */
  readonly still: readonly number[];
  /** At least this many moving floors in [from, to]. */
  readonly movingAtLeast?: { readonly count: number; readonly from: number; readonly to: number };
  /** At most this many moving floors in [from, to]. */
  readonly movingAtMost?: { readonly count: number; readonly from: number; readonly to: number };
};

/** The spec's rule per chapter ("U2: Content, schema, seeds"). */
const RULES: Readonly<Record<string, Rule>> = {
  lowtown: { still: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  city: { still: [3, 6, 9], movingAtMost: { count: 1, from: 1, to: 9 } },
  deep: { still: [1, 2, 9], movingAtLeast: { count: 3, from: 3, to: 8 } },
  snow: { still: [4, 8, 12], movingAtMost: { count: 2, from: 1, to: 14 } },
  fifty: { still: [2, 6, 8, 11], movingAtLeast: { count: 2, from: 3, to: 15 } },
};

const courseOf = (seed: number) =>
  createRaceState({ seed, lapCount: 1, tuning: artifact.content.baseTuning, players: [{ id: asPlayerId("you"), name: asPlayerName("You") }] }).course;

/** Why a seed fails a chapter, or undefined when it fits. */
function misfit(chapter: StoryChapter, seed: number): string | undefined {
  const rule = RULES[chapter.id]!;
  const floors = courseOf(seed).floors;
  const named = [...(chapter.lamps ?? []), ...chapter.phases.flatMap((phase) => phase.safeSpots ?? [])];
  for (const index of [...rule.still, ...named]) if (floors[index]?.kind !== "stationary") return `floor ${index} moves`;
  const moving = (from: number, to: number) => floors.slice(from, to + 1).filter((floor) => floor.kind === "moving").length;
  if (rule.movingAtLeast !== undefined && moving(rule.movingAtLeast.from, rule.movingAtLeast.to) < rule.movingAtLeast.count)
    return `fewer than ${rule.movingAtLeast.count} moving floors`;
  if (rule.movingAtMost !== undefined && moving(rule.movingAtMost.from, rule.movingAtMost.to) > rule.movingAtMost.count)
    return `more than ${rule.movingAtMost.count} moving floors`;
  return undefined;
}

/** The stages' own seeds, and the old story's: each fails the chapter it would serve. */
const STAGE_OWN: Readonly<Record<string, number>> = { city: 35229, deep: 107255, snow: 34528 };

describe("the story's courses", () => {
  it("has a rule for every chapter", () => {
    expect(chapters.map((chapter) => chapter.id).sort()).toEqual(Object.keys(RULES).sort());
  });

  for (const chapter of chapters) {
    it(`chapter ${chapter.id} plays seed ${chapter.seed}, which fits its rule`, () => {
      expect(misfit(chapter, chapter.seed)).toBeUndefined();
    });
  }

  it("refuses the stages' own seeds", () => {
    for (const [id, seed] of Object.entries(STAGE_OWN)) expect(misfit(chapters.find((chapter) => chapter.id === id)!, seed), id).toBeDefined();
  });

  it("refuses a seed whose floors move where the chapter needs them still", () => {
    const lowtown = chapters.find((chapter) => chapter.id === "lowtown")!;
    const bad = Array.from({ length: 50 }, (_, seed) => seed).find((seed) => misfit(lowtown, seed) !== undefined);
    expect(bad).toBeDefined();
  });

  it("keeps every glim, lamp and goal on the course", () => {
    for (const chapter of chapters) {
      const count = courseOf(chapter.seed).floorCount;
      for (const glim of chapter.glims ?? []) expect(glim.floor, chapter.id).toBeLessThan(count);
      for (const phase of chapter.phases) if (phase.goal.kind === "reach") expect(phase.goal.floor, chapter.id).toBeLessThan(count);
    }
  });
});
