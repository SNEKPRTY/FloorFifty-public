/**
 * The story hub, the chapter results and the pause's "Start chapter again"
 * (story mode v2 spec, screens 1, 4 and 5; criteria 11 and 17), on fakes.
 */

import { flushSync } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsPatch } from "../../../../apps/client/src/features/profile/settings";
import { chapterGlims } from "../../../../apps/client/src/features/story/pickups";
import { resolveStagePresentation } from "../../../../apps/client/src/features/render/stage-presentation";
import { storyWithFakes } from "../../support/fakes/screens";
import { fakeSettings } from "../../support/fakes/settings";
import { STORY, storyBot, type BotOptions } from "./support/story-bot";

const fresh = (patch: SettingsPatch = {}) =>
  fakeSettings({ ...patch, story: { chaptersDone: 0, chapters: {}, ...patch.story }, seen: { tutorial: false, ...patch.seen } });
type Story = Awaited<ReturnType<typeof storyWithFakes>>;

const allGlims = STORY.chapters.reduce((sum, chapter) => sum + chapterGlims(chapter), 0);
const cards = (screen: Story): HTMLElement[] => [...screen.stage.overlay.querySelectorAll<HTMLElement>('[data-testid="story-chapter-card"]')];
const selected = (screen: Story): number => Number(screen.query<HTMLElement>("story-hub")!.dataset["selected"]);

/** Skips the cutscene on screen and waits for the climb. */
async function intoClimb(screen: Story): Promise<void> {
  screen.click("story-cutscene-skip");
  await vi.waitFor(() => expect(screen.screen.chapterIndex()).not.toBeUndefined());
  screen.frames(1);
}

/** Plays the chapter on screen with the bot until its results are up. */
function finish(screen: Story, options?: BotOptions): void {
  const at = screen.screen.chapterIndex()!;
  screen.screen.steerWith(storyBot(STORY.chapters[at]!, options));
  for (let frame = 0; frame < 60 * 60 * 4 && screen.query("story-results") === null; frame += 10) screen.frames(10);
  screen.screen.steerWith(undefined);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the story hub", () => {
  it("opens first, on the first chapter not yet finished, with the totals and every chapter's card", async () => {
    const settings = fresh({
      story: { chaptersDone: 2, chapters: { [STORY.chapters[0]!.id]: { stars: [true, true, false], glims: 4, bestMs: 60_000 } } },
    });
    const screen = await storyWithFakes({ settings, atHub: true });
    expect(screen.query("story-hub")).not.toBeNull();
    expect(screen.query("story-cutscene")).toBeNull();
    expect(screen.screen.chapterIndex()).toBeUndefined();
    expect(selected(screen)).toBe(2);
    expect(screen.query("story-hub-totals")?.textContent?.trim()).toBe(`2 of ${STORY.chapters.length * 3} stars · 4 of ${allGlims} glims`);
    const shown = cards(screen);
    expect(shown).toHaveLength(STORY.chapters.length);
    expect(shown.map((card) => card.dataset["locked"])).toEqual(["false", "false", "false", "true", "true"]);
    expect(shown[0]!.textContent).toContain(`4 of ${chapterGlims(STORY.chapters[0]!)} glims`);
    expect(shown[3]!.textContent).toContain("Finish chapter 3 first");
    // Each card wears its first panel.
    expect(shown[0]!.querySelector("img")?.getAttribute("src")).toBe(`/assets/${STORY.cutscenes.find((cut) => cut.id === STORY.chapters[0]!.before)!.panels[0]!.art}`);
    screen.screen.exit();
  });

  it("focuses chapter 1 again once all five are done", async () => {
    const screen = await storyWithFakes({ settings: fresh({ story: { chaptersDone: 5 } }), atHub: true });
    expect(selected(screen)).toBe(0);
    screen.screen.exit();
  });

  it("disables Play on a locked chapter and says why; a press on an open card focuses it, a second plays it", async () => {
    const screen = await storyWithFakes({ settings: fresh({ story: { chaptersDone: 1 } }), atHub: true });
    cards(screen)[3]!.click();
    flushSync();
    expect(selected(screen)).toBe(3);
    expect(screen.query<HTMLButtonElement>("story-play")!.disabled).toBe(true);
    expect(screen.query("story-locked-why")?.textContent).toBe("Finish chapter 3 first");
    // A locked card's press only focuses it.
    cards(screen)[3]!.click();
    flushSync();
    expect(screen.query("story-hub")).not.toBeNull();
    cards(screen)[0]!.click();
    flushSync();
    expect(selected(screen)).toBe(0);
    expect(screen.query<HTMLButtonElement>("story-play")!.disabled).toBe(false);
    expect(screen.query("story-locked-why")).toBeNull();
    cards(screen)[0]!.click();
    flushSync();
    expect(screen.query("story-cutscene")).not.toBeNull();
    screen.screen.exit();
  });

  it("a tap on another card only chooses it, even though the tap's own focus comes first; a second tap plays", async () => {
    const screen = await storyWithFakes({ settings: fresh({ story: { chaptersDone: 2 } }), atHub: true });
    const tap = (card: HTMLElement): void => {
      card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      card.focus();
      card.click();
      flushSync();
    };
    expect(selected(screen)).toBe(2);
    tap(cards(screen)[1]!);
    expect(selected(screen)).toBe(1);
    expect(screen.query("story-hub")).not.toBeNull();
    tap(cards(screen)[1]!);
    expect(screen.query("story-cutscene")).not.toBeNull();
    screen.screen.exit();
  });

  it("moves the focus left and right on the pad's and the arrows' steer, and stays on the row's ends", async () => {
    const screen = await storyWithFakes({ settings: fresh({ story: { chaptersDone: 5 } }), atHub: true });
    const steer = (direction: string): void => {
      const event = new CustomEvent("ff-steer", { detail: { direction }, bubbles: true, cancelable: true });
      cards(screen)[selected(screen)]!.dispatchEvent(event);
      flushSync();
    };
    steer("right");
    steer("right");
    expect(selected(screen)).toBe(2);
    expect(document.activeElement).toBe(cards(screen)[2]);
    // The row is one Tab stop, the chosen card: Tab goes from it to Play, past no other card.
    expect(cards(screen).map((card) => card.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
    steer("left");
    steer("left");
    steer("left");
    expect(selected(screen)).toBe(0);
    steer("down");
    expect(document.activeElement).toBe(screen.query("story-play"));
    screen.screen.exit();
  });

  it("Play opens the focused chapter's cutscene, then its climb on its own stage and song", async () => {
    const screen = await storyWithFakes({ settings: fresh({ story: { chaptersDone: 5 } }), atHub: true });
    cards(screen)[1]!.click();
    flushSync();
    screen.click("story-play");
    expect(screen.query("story-hub")).toBeNull();
    expect(screen.query("story-cutscene")).not.toBeNull();
    await intoClimb(screen);
    const chapter = STORY.chapters[1]!;
    expect(screen.screen.chapterIndex()).toBe(1);
    expect(screen.screen.stagePresentation()).toEqual(resolveStagePresentation(chapter.stage));
    expect(screen.audio.calls).toContain(`load:song-${chapter.song.id}`);
    screen.screen.exit();
  });

  it("Back leaves the story to where it was opened", async () => {
    const screen = await storyWithFakes({ settings: fresh(), atHub: true, previousScreen: "Lobby" });
    screen.click("story-hub-back");
    expect(screen.published()).toEqual(["ui.story-closed-to-lobby"]);
    screen.screen.exit();
  });

  it("Escape is Back on the hub", async () => {
    const screen = await storyWithFakes({ settings: fresh(), atHub: true, previousScreen: "MainMenu" });
    screen.escape();
    expect(screen.published()).toEqual(["ui.story-closed-to-title"]);
    screen.screen.exit();
  });

  it("after a reload in the middle of a chapter reopens on the hub with every finished chapter's save", async () => {
    const settings = fresh();
    const first = await storyWithFakes({ settings });
    await intoClimb(first);
    finish(first);
    first.click("story-next");
    await intoClimb(first);
    first.frames(30);
    // The page goes away mid-chapter.
    first.screen.exit();
    document.body.innerHTML = "";
    const again = await storyWithFakes({ settings, atHub: true });
    expect(again.query("story-hub")).not.toBeNull();
    expect(selected(again)).toBe(1);
    expect(settings.value.story.chaptersDone).toBe(1);
    expect(settings.value.story.chapters[STORY.chapters[0]!.id]!.stars[0]).toBe(true);
    again.screen.exit();
  });
});

describe("the chapter results", () => {
  it("open over the frozen climb with the stars it earned, and pop them in on the story's clock", async () => {
    const screen = await storyWithFakes({ settings: fresh() });
    await intoClimb(screen);
    finish(screen);
    const results = screen.query("story-results")!;
    const callsAtResults = screen.audio.calls.length;
    expect(results.textContent).toContain("Chapter done!");
    expect(results.textContent).toContain("Chapter 1");
    // The climb stands still under it.
    const tick = screen.screen.tick();
    // 300 ms to the first star, 350 ms apart.
    screen.frames(75);
    expect(screen.screen.tick()).toBe(tick);
    const stars = [...results.querySelectorAll<HTMLElement>('[data-testid="story-results-star"]')];
    expect(stars.map((star) => star.dataset["earned"])).toEqual(["true", "true", "true"]);
    const total = chapterGlims(STORY.chapters[0]!);
    expect(stars[0]!.textContent).toContain("Finished");
    expect(stars[1]!.textContent).toContain(`All the glims: ${total} of ${total}`);
    expect(stars[2]!.textContent).toMatch(/Fast: \d:\d\d\.\d \(under \d:\d\d\)/);
    // One pop a star, on the story's clock, and the cheer for three.
    const sounds = screen.audio.calls.slice(callsAtResults);
    expect(sounds.filter((call) => call.startsWith("cue:ui.pop"))).toHaveLength(3);
    expect(sounds.some((call) => call.startsWith("cue:sfx.crowdCheer"))).toBe(true);
    screen.screen.exit();
  });

  it("pop no race words on the way: no place, no streak, no word sting", async () => {
    const screen = await storyWithFakes({ settings: fresh() });
    await intoClimb(screen);
    finish(screen);
    const stings = screen.audio.calls.filter((call) => call.startsWith("cue:sfx.wordPop") || call.startsWith("cue:sfx.streakStep"));
    expect(stings).toEqual([]);
    screen.screen.exit();
  });

  it("say what a star not earned takes", async () => {
    const screen = await storyWithFakes({ settings: fresh() });
    await intoClimb(screen);
    finish(screen, { skipGlims: true, dawdleTicks: 600 });
    const stars = [...screen.stage.overlay.querySelectorAll<HTMLElement>('[data-testid="story-results-star"]')];
    expect(stars[1]!.dataset["earned"]).toBe("false");
    expect(stars[1]!.textContent).toContain(`Find all ${chapterGlims(STORY.chapters[0]!)} glims`);
    screen.screen.exit();
  });

  it("Again plays the chapter once more, straight into its climb; Chapters goes to the hub where its new stars pop in", async () => {
    const settings = fresh();
    const screen = await storyWithFakes({ settings });
    await intoClimb(screen);
    finish(screen);
    screen.click("story-again");
    expect(screen.query("story-results")).toBeNull();
    expect(screen.query("story-cutscene")).toBeNull();
    await vi.waitFor(() => expect(screen.screen.run()?.state.tick ?? 1).toBe(0));
    expect(screen.screen.chapterIndex()).toBe(0);
    expect(screen.screen.run()!.director.glims.carried).toBe(0);
    // A worse run keeps every star earned before.
    finish(screen, { skipGlims: true });
    screen.click("story-results-chapters");
    expect(screen.query("story-hub")).not.toBeNull();
    expect(selected(screen)).toBe(0);
    expect(settings.value.story.chapters[STORY.chapters[0]!.id]!.stars).toEqual([true, true, true]);
    screen.screen.exit();
  });

  it("pop in on the hub only the stars that run earned for the first time", async () => {
    const screen = await storyWithFakes({ settings: fresh() });
    await intoClimb(screen);
    finish(screen, { skipGlims: true });
    screen.click("story-results-chapters");
    const card = cards(screen)[0]!;
    const fresh0 = [...card.querySelectorAll(".ff-chapter-card__star--fresh")];
    expect(fresh0.length).toBeGreaterThanOrEqual(1);
    expect(fresh0.length).toBeLessThanOrEqual(2);
    screen.screen.exit();
  });
});

describe("the pause in the story (criterion 17)", () => {
  it("Start chapter again restarts the chapter with its glims back in place", async () => {
    const screen = await storyWithFakes({ settings: fresh() });
    await intoClimb(screen);
    screen.screen.steerWith(storyBot(STORY.chapters[0]!));
    for (let frame = 0; frame < 60 * 60 && (screen.screen.run()?.director.glims.carried ?? 0) === 0; frame += 5) screen.frames(5);
    const before = screen.screen.run()!;
    expect(before.director.glims.carried).toBeGreaterThan(0);
    screen.screen.steerWith(undefined);
    screen.escape();
    expect(screen.query("pause-restart")?.textContent?.trim()).toBe("Start chapter again");
    screen.click("pause-restart");
    await vi.waitFor(() => expect(screen.screen.run() ?? before).not.toBe(before));
    const after = screen.screen.run()!;
    expect(screen.screen.chapterIndex()).toBe(0);
    expect(after.director.glims.carried).toBe(0);
    expect(after.state.tick).toBe(0);
    screen.frames(5);
    expect(screen.screen.tick()).toBeGreaterThan(0);
    screen.screen.exit();
  });
});
