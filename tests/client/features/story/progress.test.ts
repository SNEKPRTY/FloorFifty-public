/**
 * Stars and saves (story mode v2, criterion 10), and the par times checked
 * against the bot.
 */

import { describe, expect, it } from "vitest";
import {
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
  type SettingsStorage,
} from "../../../../apps/client/src/features/profile/settings";
import { firstUnfinished, recordFinish, recordOf, starsFor, totals, unlocked } from "../../../../apps/client/src/features/story/progress";
import { STORY, playChapter } from "./support/story-bot";

const memory = (seed: Record<string, string> = {}): SettingsStorage => {
  const values = new Map(Object.entries(seed));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
};

const fresh = () => loadSettings(undefined).story;
const ids = STORY.chapters.map((chapter) => chapter.id);

describe("the three stars", () => {
  const result = { glims: 7, totalGlims: 7, ms: 60_000, parSeconds: 120 };

  it("are finish, every glim and under par", () => {
    expect(starsFor(result)).toEqual([true, true, true]);
    expect(starsFor({ ...result, glims: 6 })).toEqual([true, false, true]);
    expect(starsFor({ ...result, ms: 120_000 })).toEqual([true, true, true]);
    expect(starsFor({ ...result, ms: 120_001 })).toEqual([true, true, false]);
  });

  it("are kept once earned, through a worse replay", () => {
    const best = recordFinish(fresh(), 0, "lowtown", result);
    const worse = recordFinish(best, 0, "lowtown", { ...result, glims: 2, ms: 200_000 });
    expect(recordOf(worse, "lowtown")).toEqual({ stars: [true, true, true], glims: 7, bestMs: 60_000 });
  });

  it("can be earned on separate runs", () => {
    const slowAll = recordFinish(fresh(), 0, "lowtown", { ...result, ms: 200_000 });
    const fastFew = recordFinish(slowAll, 0, "lowtown", { ...result, glims: 1, ms: 30_000 });
    expect(recordOf(fastFew, "lowtown")).toEqual({ stars: [true, true, true], glims: 7, bestMs: 30_000 });
  });

  it("unlock the next chapter and count toward the hub's line", () => {
    const after = recordFinish(fresh(), 0, "lowtown", { ...result, glims: 3 });
    expect(after.chaptersDone).toBe(1);
    expect(unlocked(after, 1)).toBe(true);
    expect(unlocked(after, 2)).toBe(false);
    expect(firstUnfinished(after, 5)).toBe(1);
    // With every chapter done the hub opens on chapter 1 again.
    expect(firstUnfinished({ ...after, chaptersDone: 5 }, 5)).toBe(0);
    expect(totals(after, ids)).toEqual({ stars: 2, glims: 3 });
    // A replay of chapter 1 never takes the unlock back.
    expect(recordFinish({ ...after, chaptersDone: 4 }, 0, "lowtown", result).chaptersDone).toBe(4);
  });
});

describe("the save", () => {
  const roundTrip = (raw: unknown) => loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify(raw) }));
  const base = { ...loadSettings(undefined), audio: { ...loadSettings(undefined).audio, music: 0.3 } };

  it("keeps a chapter's best through a save and load", () => {
    const storage = memory();
    const story = recordFinish(fresh(), 2, "deep", { glims: 5, totalGlims: 6, ms: 90_500, parSeconds: 120 });
    saveSettings(storage, { ...base, story });
    expect(loadSettings(storage).story).toEqual(story);
  });

  it("loads a value with no story field with every default, losing nothing else", () => {
    const { story: _story, ...noStory } = base;
    const loaded = roundTrip(noStory);
    expect(loaded.story).toEqual({ chaptersDone: 0, chapters: {} });
    expect(loaded.audio.music).toBe(0.3);
  });

  it("loads the first story's { chaptersDone } alone with no records", () => {
    const loaded = roundTrip({ ...base, story: { chaptersDone: 3 } });
    expect(loaded.story).toEqual({ chaptersDone: 3, chapters: {} });
    expect(loaded.audio.music).toBe(0.3);
  });

  it("drops one bad record alone", () => {
    const good = { stars: [true, false, true], glims: 4, bestMs: 5000 };
    const loaded = roundTrip({ ...base, story: { chaptersDone: 9, chapters: { lowtown: good, city: { stars: "x", glims: -1 }, deep: 7 } } });
    expect(loaded.story.chaptersDone).toBe(0);
    expect(loaded.story.chapters["lowtown"]).toEqual(good);
    expect(loaded.story.chapters["city"]).toEqual({ stars: [false, false, false], glims: 0, bestMs: null });
    expect(loaded.story.chapters["deep"]).toEqual({ stars: [false, false, false], glims: 0, bestMs: null });
    expect(loaded.audio.music).toBe(0.3);
  });
});

describe("the par times", () => {
  for (const chapter of STORY.chapters) {
    it(`for ${chapter.id} are at least 1.5 times a fast run`, () => {
      const run = playChapter(chapter);
      expect(run.run.director.done).toBe(true);
      expect(chapter.parSeconds * 1000).toBeGreaterThanOrEqual(1.5 * run.run.director.elapsedMs);
    });
  }
});
