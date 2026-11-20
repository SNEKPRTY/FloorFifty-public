/**
 * The replay's controls in view (race-options spec §10.1): on the project's own
 * viewport (780×270 phone landscape, 390×844 phone portrait, 820×1180 tablet,
 * 1280×720 desktop), every control of the bar is fully inside the screen and
 * at least 44 px, and so is Watch again on the end card.
 */

import { expect, test, type Page } from "./support/test";
import { expectScreen, finishRace } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

async function expectInView(page: Page, id: string): Promise<void> {
  const size = page.viewportSize()!;
  const box = await page.getByTestId(id).boundingBox();
  expect(box, id).not.toBeNull();
  expect(box!.x >= 0 && box!.y >= 0 && box!.x + box!.width <= size.width && box!.y + box!.height <= size.height, `${id} ${JSON.stringify(box)} in ${size.width}×${size.height}`).toBe(true);
  expect(Math.min(box!.width, box!.height), id).toBeGreaterThanOrEqual(44);
}

test("the replay's bar and end card sit in view and 44 px", async ({ browser }) => {
  test.setTimeout(120_000);
  const { pages } = await finishRace(browser);
  const viewer = pages[0]!;
  await expect(viewer.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
  await viewer.getByTestId("watch-replay").click();
  await expectScreen(viewer, "replay");
  for (const id of ["replay-play", "replay-speed", "replay-restart", "replay-follow-prev", "replay-follow-next", "replay-exit"]) {
    await expectInView(viewer, id);
  }
  const bar = viewer.getByTestId("replay-progress");
  await expectInView(viewer, "replay-progress");

  await bar.focus();
  await viewer.keyboard.press("End");
  await expect(viewer.getByTestId("replay-watch-again")).toBeVisible({ timeout: 15_000 });
  await expectInView(viewer, "replay-watch-again");
  await expectInView(viewer, "replay-back");
});
