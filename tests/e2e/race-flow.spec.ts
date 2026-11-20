/**
 * A race from the countdown to Results (race-flow spec §9.1): counted in on the
 * stage, the finish played, Results behind the wipe, in both motions; and ten
 * liquid wipes leave one veil and one GL context and nothing else behind.
 */

import { expect, test, type Page } from "./support/test";
import { readCounters } from "./support/inspection";
import { raceToResults, settledCounters } from "./support/race";
import { expectScreen, expectVeilGone, openTitle } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

/** Title → Tutorial → Title: a liquid edge each way (race-flow spec §7.1). */
async function tutorialRoundTrip(page: Page): Promise<void> {
  await page.getByTestId("quick-tutorial").click();
  await expectScreen(page, "tutorial");
  await expect(page.getByTestId("tutorial-prompt")).toBeVisible({ timeout: 20_000 });
  const coach = page.getByTestId("swipe-coach-dismiss");
  if (await coach.isVisible().catch(() => false)) await coach.click();
  await page.keyboard.press("Escape");
  await page.getByTestId("pause-leave").click();
  await expectScreen(page, "title");
}

test.describe("a race from the countdown to Results, in motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("counts in on the stage, plays the finish, and wipes to Results", async ({ browser }) => {
    test.slow();
    const { pages, heldMs } = await raceToResults(browser);
    // 150 ms ease and 1.2 s hold (race-flow spec §5.2), less a little for clocks.
    expect(heldMs, "the finish sequence held Results back").toBeGreaterThanOrEqual(1_250);
    for (const page of pages) {
      await expectVeilGone(page, "the veil leaves the page once revealed");
    }
  });
});

test.describe("a race from the countdown to Results, with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("keeps the hold, drops the slow-down, and fades rather than floods", async ({ browser }) => {
    test.slow();
    const { pages, heldMs } = await raceToResults(browser);
    expect(heldMs, "reduced motion keeps the 1.2 s hold").toBeGreaterThanOrEqual(1_100);
    for (const page of pages) await expectVeilGone(page, "the veil leaves the page once revealed");
  });
});

test.describe("ten liquid wipes", () => {
  test.use({ reducedMotion: "no-preference" });

  test("leave one veil canvas, one GL context, and every counter at baseline", async ({ page }) => {
    test.slow();
    await openTitle(page);
    // One warm-up round trip makes the veil, which is kept from then on.
    await tutorialRoundTrip(page);
    const before = await settledCounters(page);
    expect(before.displayObjects, "a title that drew nothing makes the comparison vacuous").toBeGreaterThan(0);
    for (let round = 0; round < 5; round += 1) await tutorialRoundTrip(page);

    // A GL context is counted only once its program links, so this is also
    // the wipe's shader compiling on a real GPU.
    await expect.poll(async () => (await readCounters(page)).veilCanvases, { message: "one veil canvas" }).toBe(1);
    await expect.poll(async () => (await readCounters(page)).glContexts, { message: "one GL context" }).toBe(1);
    await expect
      .poll(async () => (await readCounters(page)).displayObjects, { timeout: 15_000, message: "display objects back to baseline" })
      .toBe(before.displayObjects);
    await expect
      .poll(async () => (await readCounters(page)).audioSources, { timeout: 15_000, message: "audio sources back to baseline" })
      .toBe(before.audioSources);
  });
});
