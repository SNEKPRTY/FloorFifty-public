import { expect, type Browser, type Page } from "@playwright/test";
import type { Sweep } from "./layout";
import { expectScreen, openTitle } from "./room-driver";

/** Puts the prompt back in the device's own wording after a key press drove the run. */
export async function noteTouch(page: Page, sweep: Sweep): Promise<void> {
  if (!sweep.touch) return;
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch" })));
}

/** What a chapter's first words look like on screen: a line of talk, or the chip that names the control. */
export const storyWords = (page: Page) => page.getByTestId("story-line").or(page.getByTestId("story-chip")).first();

/** The title's Story, at `sweep`'s viewport, past the first-run swipe coach. */
export async function openStory(browser: Browser, sweep: Sweep): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: sweep.width, height: sweep.height },
    hasTouch: sweep.touch,
    isMobile: sweep.touch && sweep.factor !== "desktop",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await openTitle(page);
  await page.evaluate(() => document.fonts.ready);
  await enterStory(page);
  return page;
}

/** From the title: Story, to its hub (the chapter select). */
export async function openHub(page: Page): Promise<void> {
  await page.getByTestId("quick-story").click();
  await expectScreen(page, "story");
  await expect(page.getByTestId("story-hub")).toBeVisible({ timeout: 30_000 });
}

/** From the title: Story, Play on the hub's chapter, its cutscene skipped, to the first words of the climb, past the swipe coach where a finger plays. */
export async function enterStory(page: Page): Promise<void> {
  await openHub(page);
  await page.getByTestId("story-play").click();
  await page.getByTestId("story-cutscene-skip").click({ timeout: 30_000 });
  await expect(storyWords(page)).toBeVisible({ timeout: 30_000 });
  const coach = page.getByTestId("swipe-coach-dismiss");
  if (await coach.isVisible().catch(() => false)) await coach.click();
}
