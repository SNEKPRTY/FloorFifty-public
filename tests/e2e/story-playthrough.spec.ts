import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { SETTINGS_KEY } from "../../apps/client/src/features/profile/settings";
import { FRAME_CONTROL } from "./support/frame-control";
import { expectScreen, openTitle } from "./support/room-driver";
import { openHub, storyWords } from "./support/story";
import { driveInPage, keyHands, playChapter, stepFrames, takeFrames } from "./support/story-play";

/**
 * The whole story, played on the keys (story mode v2 spec, criteria 1, 2, 9, 12 and 20): the hub, each
 * chapter's cutscene, its climb to the goal, its results, the ending and the last card, and what is saved
 * after a reload. The climbs are played by the story bot inside the page (an inspection build), on stepped
 * frames: a software-drawn browser plays them at about a tick a second, so this spec takes most of an hour
 * there and a minute or two on a GPU. It is off the gate, like the rest of the browser suite.
 */

const SMALL = { width: 640, height: 360 };

// A step that waits on something that never comes fails within a minute, at its own line, instead of at the test's limit.
test.use({ viewport: SMALL, reducedMotion: "reduce", actionTimeout: 60_000, navigationTimeout: 60_000 });

/** Steps the taken-over clock until `target` is visible, a few frames at a time. */
async function stepTo(page: Page, target: Locator, frames = 600): Promise<void> {
  for (let spent = 0; spent < frames; spent += 10) {
    if (await target.isVisible().catch(() => false)) return;
    await stepFrames(page, 10);
  }
  await expect(target).toBeVisible({ timeout: 1 });
}

/** On the hub with chapter `index` selected: Play, the cutscene skipped, to the climb's first words. */
async function startChapter(page: Page, index: number): Promise<void> {
  await expect(page.getByTestId("story-hub")).toHaveAttribute("data-selected", String(index));
  await page.getByTestId("story-play").click({ force: true });
  await stepTo(page, page.getByTestId("story-cutscene-skip"));
  await page.getByTestId("story-cutscene-skip").click({ force: true });
  // The climb's HUD: a chapter may open on its card alone, its first words coming later (The Deep speaks when a floor swims).
  await stepTo(page, page.getByTestId("hud-floors"));
}

// After `takeFrames` the page draws only when stepped, so a click's wait for a stable element (which
// waits on animation frames) would never end: every click here is forced, and the frames are stepped instead.

const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as { story?: { chaptersDone: number; chapters: Record<string, { stars: boolean[] }> } }, SETTINGS_KEY);

test("the whole story on the keys: five chapters, their results, the ending, the last card, and all of it kept after a reload", async ({ page }) => {
  test.setTimeout(100 * 60_000);
  await page.addInitScript(FRAME_CONTROL);
  await openTitle(page);
  await openHub(page);
  await expect(page.locator('[data-testid="story-chapter-card"][data-locked="true"]'), "four chapters wait their turn").toHaveCount(4);
  await takeFrames(page);
  const hands = keyHands(page);

  for (let index = 0; index < 5; index += 1) {
    await startChapter(page, index);
    const ticks = await playChapter(page, hands, 6_000, undefined, (line) => console.log(`chapter ${index + 1}: ${line}`));
    expect(ticks, `chapter ${index + 1}'s goal was reached inside the limit`).toBeLessThan(6_000);
    const results = page.getByTestId("story-results");
    await stepTo(page, results);
    await expect(page.getByTestId("story-results-star").first(), "finishing earns the first star").toHaveAttribute("data-earned", "true");
    if (index < 4) {
      // Back to the hub once, to see the next chapter open; then on from the hub.
      await page.getByTestId("story-results-chapters").click({ force: true });
      await stepTo(page, page.getByTestId("story-hub"));
      await expect(page.locator(`[data-testid="story-chapter-card"][data-chapter="${index + 2}"]`)).toHaveAttribute("data-locked", "false");
      await expect(page.getByTestId("story-hub")).toHaveAttribute("data-selected", String(index));
      await page.locator(`[data-testid="story-chapter-card"][data-chapter="${index + 2}"]`).click({ force: true });
    } else {
      await page.getByTestId("story-next").click({ force: true });
    }
  }

  // The ending: its cutscene, then the last card, whose Chapters goes back to the hub.
  await stepTo(page, page.getByTestId("story-cutscene-skip"));
  await page.getByTestId("story-cutscene-skip").click({ force: true });
  await stepTo(page, page.getByTestId("story-finale"));
  const save = await stored(page);
  expect(save.story?.chaptersDone, "all five chapters are saved as done").toBe(5);
  expect(Object.values(save.story?.chapters ?? {}).filter((record) => record.stars[0]).length).toBe(5);

  await page.reload();
  await openTitle(page);
  await openHub(page);
  await expect(page.locator('[data-testid="story-chapter-card"][data-locked="true"]'), "nothing is locked after the reload").toHaveCount(0);
  await expect(page.getByTestId("story-hub-totals")).toBeVisible();
  await page.getByTestId("story-hub-back").click({ force: true });
  await expectScreen(page, "title");
});

test("the lava catches an idle racer and she starts again from the safe spot, Start again begins the chapter afresh, and a reload keeps what was done", async ({ context, page }) => {
  test.setTimeout(60 * 60_000);
  // Three chapters done: the snow chapter, whose lava chases the player, is next.
  await context.addInitScript((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    if (stored["story"] === undefined) localStorage.setItem(key, JSON.stringify({ ...stored, version: 2, story: { chaptersDone: 3, chapters: {} } }));
  }, SETTINGS_KEY);
  await page.addInitScript(FRAME_CONTROL);
  await openTitle(page);
  await openHub(page);
  await takeFrames(page);
  await startChapter(page, 3);

  // Nothing pressed: the lava rises after its grace and catches her; the climb goes on, never the results.
  const banner = page.getByTestId("out-banner");
  await stepTo(page, banner, 3_000);
  await stepTo(page, storyWords(page), 600);
  await expect(page.getByTestId("story-results"), "being caught never ends the chapter").toHaveCount(0);

  // Start again, from the pause: the run begins afresh.
  const tick = () => page.evaluate(() => (window as unknown as { __ffStory: () => { tick: number } }).__ffStory().tick);
  const before = await tick();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause-overlay")).toBeVisible();
  await page.getByTestId("pause-restart").click({ force: true });
  await stepTo(page, storyWords(page));
  expect(await tick(), "the chapter started again from its first tick").toBeLessThan(before);

  // Played to the goal from there.
  const ticks = await playChapter(page, keyHands(page), 6_000, undefined, (line) => console.log(`snow, again: ${line}`));
  expect(ticks).toBeLessThan(6_000);
  await stepTo(page, page.getByTestId("story-results"));
  console.log("snow, again: the results");
  await page.getByTestId("story-results-chapters").click({ force: true });
  await stepTo(page, page.getByTestId("story-hub"));
  console.log("snow, again: the hub");

  // A reload: the hub opens on the next chapter, with the snow's stars kept.
  await page.reload();
  await openTitle(page);
  await openHub(page);
  await expect(page.getByTestId("story-hub")).toHaveAttribute("data-selected", "4");
  const save = await stored(page);
  expect(save.story?.chaptersDone).toBe(4);
});

// Re-check 3, R1 and R2: a chasing lava is kept close enough to see on a wide screen, and the camera looks down
// only a little, so the racer stays below the HUD. Each chapter with one is played by the bot at the review's
// two wide views; every 30 ticks of a chasing lava (after a phase's first half second) the edge must be inside the part of the field a player sees.
for (const view of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "iPad landscape", width: 1180, height: 820 },
]) {
  test.describe(`the chasing lava on screen, ${view.name}`, () => {
    test.use({ viewport: { width: view.width, height: view.height }, reducedMotion: "no-preference" });

    test(`${view.width}x${view.height}: the lava's edge is in view through every chase`, async ({ context, page }, testInfo) => {
      test.setTimeout(60 * 60_000);
      await context.addInitScript((key) => {
        const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
        if (stored["story"] === undefined) localStorage.setItem(key, JSON.stringify({ ...stored, version: 2, story: { chaptersDone: 5, chapters: {} } }));
      }, SETTINGS_KEY);
      await page.addInitScript(FRAME_CONTROL);
      await openTitle(page);
      await openHub(page);
      await takeFrames(page);
      // The bot drives inside the tick, so every run of this check plays the same ticks; keys from outside land a frame early or late.
      await expect.poll(() => driveInPage(page)).toBe(true);
      const hands = async (): Promise<void> => {};
      for (const index of [0, 2, 3, 4]) {
        // A tap on the chosen card plays it: tap only a card that is not chosen yet.
        if ((await page.getByTestId("story-hub").getAttribute("data-selected")) !== String(index)) {
          await page.locator(`[data-testid="story-chapter-card"][data-chapter="${index + 1}"]`).click({ force: true });
          await stepFrames(page, 10);
        }
        await startChapter(page, index);
        let samples = 0;
        let shown = 0;
        const missed: number[] = [];
        let shot = 0;
        const ticks = await playChapter(page, hands, 6_000, (now) => {
          // The first half second of a phase is the camera settling after its cut (a rescue, a phase line), not a chase.
          if (now.lava?.under === "player" && now.lava.phaseTicks >= 30 && now.tick % 30 === 0) {
            samples += 1;
            if (now.lava.onScreen) shown += 1;
            else missed.push(now.tick);
          }
          return false;
        }, undefined, async (now) => {
          // A picture every 60 ticks of a chasing lava, for the person who checks this run.
          if (now.lava?.under === "player" && now.tick % 60 === 0 && shot < 60) {
            shot += 1;
            await page.screenshot({ path: testInfo.outputPath(`ch${index + 1}-t${String(now.tick).padStart(4, "0")}.png`) });
          }
        });
        const doneAt = await page.evaluate(() => (window as unknown as { __ffStory?: () => { doneAtTick?: number } }).__ffStory?.().doneAtTick);
        console.log(`chapter ${index + 1}: lava in view ${shown} of ${samples}; missed at ${missed.join(", ")}; ${ticks} frames, done at tick ${doneAt}`);
        // Soft, so one chapter's shortfall still lets the next ones be measured and shot.
        expect.soft(samples, `chapter ${index + 1} has a chasing lava`).toBeGreaterThanOrEqual(3);
        expect.soft(shown / samples, `chapter ${index + 1}: the lava's edge in view`).toBeGreaterThanOrEqual(0.9);
        await stepTo(page, page.getByTestId("story-results"));
        await page.getByTestId("story-results-chapters").click({ force: true });
        await stepTo(page, page.getByTestId("story-hub"));
      }
    });
  });
}
