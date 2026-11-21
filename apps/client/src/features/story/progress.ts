/**
 * Stars and saved progress (story mode v2 spec, "Stars and saved progress").
 *
 * Three stars a chapter: finish it, carry up every glim in it, finish at or
 * under its par time. A star once earned is kept, glims save as the best
 * count, and times as the fastest. Pure functions over `settings.story`.
 */

import { freshChapterRecord, type Settings, type StoryChapterRecord } from "../profile/settings";

export type StoryProgress = Settings["story"];

/** One finished run of a chapter. */
export type ChapterResult = {
  readonly glims: number;
  readonly totalGlims: number;
  /** First input to goal, catches included. */
  readonly ms: number;
  readonly parSeconds: number;
};

/** The stars one run earns, on its own. */
export function starsFor(result: ChapterResult): [boolean, boolean, boolean] {
  return [true, result.glims >= result.totalGlims, result.ms <= result.parSeconds * 1000];
}

/** A chapter's record, or a fresh one. */
export const recordOf = (progress: StoryProgress, chapterId: string): StoryChapterRecord =>
  progress.chapters[chapterId] ?? freshChapterRecord();

/** Progress after finishing chapter `index` (from 0) with `result`: nothing earned before is lost. */
export function recordFinish(progress: StoryProgress, index: number, chapterId: string, result: ChapterResult): StoryProgress {
  const before = recordOf(progress, chapterId);
  const earned = starsFor(result);
  const ms = Math.max(1, Math.round(result.ms));
  const record: StoryChapterRecord = {
    stars: [before.stars[0] || earned[0], before.stars[1] || earned[1], before.stars[2] || earned[2]],
    glims: Math.max(before.glims, result.glims),
    bestMs: before.bestMs === null ? ms : Math.min(before.bestMs, ms),
  };
  return {
    chaptersDone: Math.max(progress.chaptersDone, index + 1),
    chapters: { ...progress.chapters, [chapterId]: record },
  };
}

/** Whether chapter `index` (from 0) can be played: the first, or one after a finished one. */
export const unlocked = (progress: StoryProgress, index: number): boolean => index <= progress.chaptersDone;

/** The stars and best glims over every chapter, for the hub's line. */
export function totals(progress: StoryProgress, chapterIds: readonly string[]): { stars: number; glims: number } {
  let stars = 0;
  let glims = 0;
  for (const id of chapterIds) {
    const record = recordOf(progress, id);
    stars += record.stars.filter(Boolean).length;
    glims += record.glims;
  }
  return { stars, glims };
}

/** The first chapter not yet finished, for the hub's focus; the first again once all are. */
export const firstUnfinished = (progress: StoryProgress, count: number): number => (progress.chaptersDone >= count ? 0 : progress.chaptersDone);

/** A chapter as the hub shows it. */
export type HubChapter = {
  readonly title: string;
  /** Its first panel's picture. */
  readonly art: string | undefined;
  readonly stars: readonly [boolean, boolean, boolean];
  readonly glims: number;
  readonly glimsTotal: number;
  readonly locked: boolean;
};
