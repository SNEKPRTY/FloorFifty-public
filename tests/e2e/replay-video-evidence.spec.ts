/**
 * Save video and Share video in the replay window (unlockables spec §6.4,
 * amended): after a real race, recorded live, both icons are enabled, in
 * view, 44 px, and clear of the HUD, while the replay plays and on its end
 * card. Each project writes `evidence/replay-video/<project>-<shot>.png`.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "./support/test";
import { evidenceDir } from "./support/evidence";
import { expectScreen, finishRace } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

const OUT = evidenceDir("replay-video");

test.beforeAll(async () => {
  await waitForServer();
  mkdirSync(OUT, { recursive: true });
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** In view, 44 px, and over none of the HUD. */
async function expectPlaced(page: Page, id: string): Promise<void> {
  const size = page.viewportSize()!;
  const box = (await page.getByTestId(id).boundingBox())!;
  expect(box, id).not.toBeNull();
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height, `${id} ${JSON.stringify(box)}`).toBe(true);
  expect(Math.min(box.width, box.height), id).toBeGreaterThanOrEqual(44);
  for (const hud of await page.locator('[data-testid="race-hud"] [data-testid^="hud-"]').all()) {
    const other = await hud.boundingBox();
    if (other === null || other.width === 0 || !(await hud.isVisible())) continue;
    expect(overlaps(box, other), `${id} over ${await hud.getAttribute("data-testid")}`).toBe(false);
  }
}

test("Save video and Share video sit under the HUD, enabled by the live recording", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const { pages } = await finishRace(browser);
  const viewer = pages[0]!;
  await expect(viewer.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
  await viewer.getByTestId("watch-replay").click();
  await expectScreen(viewer, "replay");
  await expect(viewer.getByTestId("replay-save-video")).toBeEnabled({ timeout: 10_000 });
  for (const id of ["replay-save-video", "replay-share-video"]) await expectPlaced(viewer, id);
  await viewer.screenshot({ path: resolve(OUT, `${info.project.name}-playing.png`) });

  await viewer.getByTestId("replay-progress").focus();
  await viewer.keyboard.press("End");
  await expect(viewer.getByTestId("replay-watch-again")).toBeVisible({ timeout: 15_000 });
  for (const id of ["replay-save-video", "replay-share-video"]) await expectPlaced(viewer, id);
  await viewer.screenshot({ path: resolve(OUT, `${info.project.name}-end-card.png`) });

  const download = viewer.waitForEvent("download");
  await viewer.getByTestId("replay-save-video").click();
  const saved = await download;
  const name = saved.suggestedFilename();
  expect(name).toMatch(/^floor-fifty-[a-z-]+-\d{8}-\d{4}\.(mp4|webm)$/);
  // Kept beside the shots, so the video's own quality can be judged.
  await saved.saveAs(resolve(OUT, `${info.project.name}-sample.${name.split(".").pop()}`));
});
