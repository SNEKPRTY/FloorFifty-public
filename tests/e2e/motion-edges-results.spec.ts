/**
 * The motion edges of the results and replay screens on the kit (shared-components spec, U3e):
 * the results columns rise in the calmer 300 ms reveal, the replay's hint rises and falls like any
 * toast, the speed label rolls its digit, and Save and Share swap their picture for a tick once
 * done. Each row is read in the page, never by timed screenshots (the frame cap in software WebGL
 * makes those land anywhere), in normal motion and in reduced motion (the end state at once).
 *
 * Desktop only: one finished race is walked, and replay needs no touch.
 */
import { expect, test, type Page } from "./support/test";
import { waitForServer } from "./support/server-fixture";
import { finishRace } from "./support/room-driver";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await waitForServer();
});

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one finished race, walked on the desktop project");
});

const MOTIONS = ["no-preference", "reduce"] as const;

/**
 * Records the lowest opacity each results column shows from the moment it exists. A mutation
 * observer reads it whenever the DOM or an inline style changes, so the rise's first frame (opacity
 * 0, written as the column mounts) is caught even when the frame cap holds the main thread past the
 * whole 300 ms tween; an 8 ms poll alone missed it about two runs in three on software WebGL.
 */
const WATCH_COLUMNS = (): void => {
  const lows: number[] = [];
  (window as unknown as { __columnLows: number[] }).__columnLows = lows;
  const sample = (): void => {
    document.querySelectorAll<HTMLElement>('[data-testid="game-end"] .ff-results__column').forEach((column, index) => {
      lows[index] = Math.min(lows[index] ?? 1, Number(getComputedStyle(column).opacity));
    });
  };
  new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
  window.setInterval(sample, 8);
};

async function openReplay(page: Page): Promise<void> {
  await expect(page.getByTestId("watch-replay")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("watch-replay").click();
  await expect(page.getByTestId("replay-controls")).toBeVisible();
}

for (const motion of MOTIONS) {
  test.describe(`results and replay, motion ${motion}`, () => {
    test.use({ reducedMotion: motion });

    test("the results columns rise in over 300 ms, or land at once", async ({ browser }) => {
      test.setTimeout(240_000);
      const { pages } = await finishRace(browser, { context: { reducedMotion: motion }, settings: { locale: "en" } });
      const page = pages[0]!;
      // The race has ended already; leaving the results and coming back runs the reveal once more.
      await openReplay(page);
      // Watched from an empty page, so only the columns of the screen coming back are read.
      await expect(page.getByTestId("game-end")).toHaveCount(0);
      await page.evaluate(WATCH_COLUMNS);
      await page.getByTestId("replay-back").or(page.getByTestId("replay-exit")).first().click();
      await expect(page.getByTestId("game-end")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(700);
      const lows = await page.evaluate(() => (window as unknown as { __columnLows: number[] }).__columnLows);
      expect(lows.length, "both columns were watched").toBeGreaterThanOrEqual(2);
      if (motion === "no-preference") for (const low of lows) expect(low, "each column began faded").toBeLessThan(1);
      else for (const low of lows) expect(low, "reduced motion lands at once").toBe(1);
      for (const column of await page.locator('[data-testid="game-end"] .ff-results__column').all()) {
        await expect(column).toHaveCSS("opacity", "1");
      }
    });

    test("replay: the hint rises when the bar steps aside and falls when it returns; the speed rolls; Save ticks", async ({ browser }) => {
      test.setTimeout(240_000);
      const { pages } = await finishRace(browser, { context: { reducedMotion: motion }, settings: { locale: "en" } });
      const page = pages[0]!;
      await openReplay(page);

      // The row keeps one height: the kit's icon buttons do not shrink under the bar's 48 px buttons.
      const heights = await Promise.all(
        ["replay-play", "replay-speed", "replay-follow-prev", "replay-follow-next"].map(async (id) => (await page.getByTestId(id).boundingBox())!.height),
      );
      expect(new Set(heights.map(Math.round)).size, `play, speed and follow buttons share one height (${heights.join(", ")})`).toBe(1);

      // Speed: the digit rolls (a cell marked rolling) and the label changes; reduced motion swaps it at once.
      const speed = page.getByTestId("replay-speed");
      const before = ((await speed.textContent()) ?? "").trim();
      await speed.evaluate((node) => {
        (window as unknown as { __rolled: boolean }).__rolled = false;
        new MutationObserver(() => {
          if (node.querySelector('[data-rolling="true"]') !== null) (window as unknown as { __rolled: boolean }).__rolled = true;
        }).observe(node, { childList: true, subtree: true, attributes: true });
      });
      await speed.click();
      await expect.poll(async () => ((await speed.textContent()) ?? "").trim()).not.toBe(before);
      expect(await page.evaluate(() => (window as unknown as { __rolled: boolean }).__rolled), "a digit rolled").toBe(motion === "no-preference");

      // Save: the picture is swapped for a tick, then comes back.
      const save = page.getByTestId("replay-save-video");
      if (await save.isEnabled()) {
        await save.click();
        await expect(save.locator('[data-confirm-label="done"]')).toBeVisible();
        await expect(save.locator('[data-confirm-label="idle"]')).toBeVisible({ timeout: 5_000 });
        expect(((await save.textContent()) ?? "").trim(), "never words").toBe("");
      }

      // Hint: no input for the idle time, the hint rises in; a touch of the mouse sends it away.
      const hint = page.getByTestId("replay-hint");
      await expect(hint).toBeVisible({ timeout: 10_000 });
      await page.mouse.move(40, 40);
      await page.mouse.move(80, 90);
      if (motion === "no-preference") {
        const leaving = await hint.evaluate((node) => (node as HTMLElement).inert).catch(() => true);
        expect(leaving, "inert from its first exit frame, or already gone").toBe(true);
      }
      await expect(hint).toHaveCount(0, { timeout: 3_000 });
    });
  });
}
