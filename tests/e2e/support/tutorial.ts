import { expect, type Browser, type Page } from "@playwright/test";
import type { Sweep } from "./layout";
import { expectScreen, openTitle } from "./room-driver";

/** Puts the prompt back in the device's own wording after a key press drove the run. */
export async function noteTouch(page: Page, sweep: Sweep): Promise<void> {
  if (!sweep.touch) return;
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch" })));
}

/** The title's Tutorial, at `sweep`'s viewport, past the first-run swipe coach. */
export async function openTutorial(browser: Browser, sweep: Sweep): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: sweep.width, height: sweep.height },
    hasTouch: sweep.touch,
    isMobile: sweep.touch && sweep.factor !== "desktop",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await openTitle(page);
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId("quick-tutorial").click();
  await expectScreen(page, "tutorial");
  await expect(page.getByTestId("tutorial-prompt")).toBeVisible({ timeout: 20_000 });
  // The swipe coach, where touch shows it, is its own first-run card.
  const coach = page.getByTestId("swipe-coach-dismiss");
  if (await coach.isVisible().catch(() => false)) await coach.click();
  return page;
}
