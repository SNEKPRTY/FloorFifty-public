/**
 * Survival's lava (lava spec §5, §6), for the owner's gate: a race left alone
 * after one first press at GO, shot once a second, so the set runs from the
 * marker (the lava still below the view) through the lava rising into view to
 * a racer sinking in it. The press is there because a racer's lava now waits
 * for her first input (first-race spec part 2); with no press the lava stays
 * down for the first 10 s and these shots show nothing happening.
 * Writes to `evidence/survival-lava/`, which git ignores; nothing is compared.
 */
import { PNG } from "pngjs";
import { expect, test } from "./support/test";
import { evidenceDir } from "./support/evidence";
import { chooseMode, createRoom, expectScreen, joinRoom, openClients, passSelect, pickStage, readyOnly } from "./support/room-driver";

const SHOTS = evidenceDir("survival-lava");

test("an idle Survival race, from the marker to the lava", async ({ browser }, testInfo) => {
  // Desktop, and a phone held upright, where the marker is drawn smallest (final review I4).
  const project = testInfo.project.name;
  test.skip(project !== "desktop" && project !== "mobile-portrait", "the largest viewport and the smallest");
  test.slow();
  const pages = await openClients(browser, 2);
  const host = pages[0]!;
  try {
    const code = await createRoom(host, "Kite");
    await joinRoom(pages[1]!, code, "Ninja 2");
    await chooseMode(host, "infinite");
    await readyOnly(pages);
    for (const page of pages) {
      await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
      await pickStage(page, "rooftops");
    }
    await passSelect(pages);
    await expectScreen(host, "gameplay");
    await host.bringToFront();
    // The gameplay screen shows during the countdown, and the room ignores a
    // press that ends before GO. The start prompt is shown only from GO, so
    // waiting for it is waiting for GO.
    await expect(host.getByTestId("start-prompt")).toBeVisible();
    // One fast-fall press, which steers nowhere: the lava's rest starts from it.
    await host.keyboard.press("KeyS");
    // The prompt goes once she has started. Without this the spec would pass on
    // an idle race, which is what the shots are meant to show is not the case.
    await expect(host.getByTestId("start-prompt")).toHaveCount(0);
    for (let second = 1; second <= 10; second += 1) {
      await host.waitForTimeout(1_000);
      const shot = await host.screenshot({ path: `${SHOTS}/${project}-idle-${String(second).padStart(2, "0")}s.png` });
      if (project === "desktop") {
        const png = PNG.sync.read(shot);
        for (const x of [0.25, 0.5, 0.75]) {
          const at = ((png.height - 2) * png.width + Math.floor(png.width * x)) * 4;
          // The warm lava raises red; the screen lighting may still tint the
          // bars blue, so test its red channel rather than all three channels.
          expect(png.data[at], `no warm lava over the lower bar at ${second}s, x=${x}`).toBeLessThan(64);
        }
      }
    }
  } finally {
    for (const page of pages) await page.context().close().catch(() => undefined);
  }
});
