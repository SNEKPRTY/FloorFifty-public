import { expect, test, type Page } from "./support/test";
import { createRoom, openClients, pressLockIn, readyOnly } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * The reveal's result grows out of the art the player was looking at to fill
 * the whole screen (`growFrom`). It measures both boxes once, as the fill
 * mounts, so the reveal must already stand in the whole select area then. The
 * stage step pages out over a beat as its reveal mounts; laid out beside it,
 * the reveal was pushed into a second row and the art grew to a strip
 * (phase 6). Alone in a room the result is known at once, so the fill mounts
 * on the reveal's first frame, inside that beat.
 */
test.use({ reducedMotion: "no-preference" });

test.beforeAll(async () => {
  await waitForServer();
});

type Box = { y: number; height: number };
type GrowWatch = { atMount?: { reveal: Box; select: Box }; late?: { fill: Box; select: Box } };

/** Watches for the next fill: the reveal's box as it mounts, and the fill's as the grow ends. */
async function watchNextFill(page: Page): Promise<void> {
  await page.evaluate(() => {
    const box = (element: Element | null): Box => {
      const rect = element?.getBoundingClientRect();
      return { y: Math.round(rect?.top ?? 0), height: Math.round(rect?.height ?? 0) };
    };
    const watch: GrowWatch = {};
    (window as unknown as { __growWatch: GrowWatch }).__growWatch = watch;
    const observer = new MutationObserver(() => {
      // The step before fades out over the new one for a beat, still holding its own reveal: the
      // reveal being watched is the one in the view that takes input.
      const fill = document.querySelector(".ff-view:not([inert]) [data-testid=roulette-fill]");
      if (fill === null) return;
      observer.disconnect();
      const select = document.querySelector("[data-testid=select-screen]");
      watch.atMount = { reveal: box(document.querySelector(".ff-view:not([inert]) [data-testid=roulette]")), select: box(select) };
      // Most of the way through the grow (`GROW` is 0.6 s, eased out).
      setTimeout(() => (watch.late = { fill: box(fill), select: box(select) }), 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function expectFullGrow(page: Page, step: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __growWatch: GrowWatch }).__growWatch.late !== undefined), { timeout: 10_000 }).toBe(true);
  const watch = await page.evaluate(() => (window as unknown as { __growWatch: GrowWatch }).__growWatch);
  expect(watch.atMount?.reveal, `the ${step} reveal fills the select area as its fill mounts`).toEqual(watch.atMount?.select);
  expect(watch.late!.fill.height, `the ${step} result's art has grown to near the whole area`).toBeGreaterThan(watch.late!.select.height * 0.9);
}

test("alone in a room, each reveal's art grows to fill the whole select area", async ({ browser }) => {
  test.slow();
  const [page] = (await openClients(browser, 1)) as [Page];
  try {
    await createRoom(page, "Alpha");
    await readyOnly([page]);
    await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
    await watchNextFill(page);
    await pressLockIn(page);
    await expectFullGrow(page, "stage");

    await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "song", { timeout: 15_000 });
    await watchNextFill(page);
    await pressLockIn(page);
    await expectFullGrow(page, "song");
  } finally {
    await page.context().close();
  }
});
