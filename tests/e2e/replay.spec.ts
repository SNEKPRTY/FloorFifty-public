/**
 * The replay in the browser (race-options spec §7): watched from Results at
 * 2× to the end with no drift and the same winner, its position bar seeking by
 * drag and by key and back from the end card, its bar in view at four
 * sizes, out to the room once the room has moved on, and nothing left behind.
 *
 * Runs on `desktop` (Chromium) and on `webkit-replay`: the re-simulation's
 * floats must agree in both engines (spec §7.4), and the absence of the drift
 * notice is that agreement, checked every second of the race.
 */

import { expect, test, type Page } from "./support/test";
import { expectScreenContract } from "./support/contract";
import { readCounters } from "./support/inspection";
import { CLIENT_FOLLOWS_MS, SCREEN_SETTLE_MS, expectScreen, finishRace } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

async function watch(page: Page): Promise<void> {
  await expect(page.getByTestId("watch-replay")).toBeEnabled({ timeout: SCREEN_SETTLE_MS });
  await page.getByTestId("watch-replay").click();
  await expectScreen(page, "replay");
}

test.describe("the replay (race-options spec §7)", () => {
  test("watched at 2× to the end, with Results' standings and no drift", async ({ browser }) => {
    test.setTimeout(180_000);
    const { pages } = await finishRace(browser);
    const viewer = pages[0]!;
    const winner = await viewer.getByTestId("winner").textContent();
    const order = (await viewer.getByTestId("result-name").allTextContents()).map((name) => name.trim());
    await watch(viewer);
    await viewer.keyboard.press("s");
    await expect(viewer.getByTestId("replay-speed")).toHaveText("2×");
    await expect(viewer.getByTestId("replay-watch-again")).toBeVisible({ timeout: 90_000 });
    await expect(viewer.getByTestId("replay-controls")).toHaveAttribute("data-standings", order.join("|"));
    await expect(viewer.getByTestId("replay-drift")).toHaveCount(0);
    await viewer.getByTestId("replay-back").click();
    await expectScreen(viewer, "game-end");
    await expect(viewer.getByTestId("winner")).toHaveText(winner!);
  });

  for (const [width, height] of [
    [780, 270],
    [390, 844],
    [820, 1180],
    [1280, 720],
  ] as const) {
    test(`keeps every control in view and 44 px at ${width}×${height}`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { pages } = await finishRace(browser);
      const viewer = pages[0]!;
      await viewer.setViewportSize({ width, height });
      await watch(viewer);
      // The bar steps aside after 2.5 s; a pointer move brings it back.
      await viewer.mouse.move(width / 2, height / 3);
      await viewer.mouse.move(width / 2 + 10, height / 3);
      await expect(viewer.getByTestId("replay-controls")).toHaveAttribute("data-idle", "false");
      for (const id of ["replay-play", "replay-speed", "replay-restart", "replay-follow-prev", "replay-follow-next", "replay-exit"]) {
        const box = await viewer.getByTestId(id).boundingBox();
        expect(box, id).not.toBeNull();
        expect(box!.x >= 0 && box!.y >= 0 && box!.x + box!.width <= width && box!.y + box!.height <= height, id).toBe(true);
        expect(Math.min(box!.width, box!.height), id).toBeGreaterThanOrEqual(44);
      }
      // Inside the visible band, never on the letterbox's bars (M6).
      await expectScreenContract(viewer, { screen: "replay" });
    });
  }

  test("the bar steps aside after 2.5 s without input, and comes back on a pointer move", async ({ browser }) => {
    test.setTimeout(120_000);
    const { pages } = await finishRace(browser);
    const viewer = pages[0]!;
    await watch(viewer);
    const bar = viewer.getByTestId("replay-controls");
    await expect(bar).toHaveAttribute("data-idle", "true", { timeout: CLIENT_FOLLOWS_MS });
    await viewer.mouse.move(120, 120);
    await viewer.mouse.move(160, 140);
    await expect(bar).toHaveAttribute("data-idle", "false");
    // Paused, it is in use, so it stays.
    await viewer.getByTestId("replay-play").click();
    await expect(viewer.getByTestId("replay-play")).toHaveAttribute("aria-label", "Play");
    await viewer.waitForTimeout(3_500);
    await expect(bar).toHaveAttribute("data-idle", "false");
    await viewer.keyboard.press("Escape");
    await expectScreen(viewer, "game-end");
  });

  test("the position bar seeks by drag and by key, holds while held, and drags back from the end card", async ({ browser }) => {
    test.setTimeout(180_000);
    const { pages } = await finishRace(browser);
    const viewer = pages[0]!;
    await watch(viewer);
    const bar = viewer.getByTestId("replay-progress");
    const seconds = async (): Promise<number> => Number(await bar.inputValue());
    const length = Number(await bar.getAttribute("max"));
    expect(length).toBeGreaterThan(4);
    /** The page point a fraction of the way along the bar, as a finger would press it. */
    const along = async (fraction: number): Promise<{ x: number; y: number }> => {
      const box = (await bar.boundingBox())!;
      return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
    };

    // Pressed and dragged to three quarters: the replay holds there while
    // the button is down, and plays on once it is let go.
    const start = await along(0.1);
    await viewer.mouse.move(start.x, start.y);
    await viewer.mouse.down();
    const end = await along(0.75);
    await viewer.mouse.move(end.x, end.y, { steps: 8 });
    await expect.poll(seconds).toBeGreaterThanOrEqual(Math.floor(length * 0.75) - 1);
    const held = await seconds();
    await viewer.waitForTimeout(1_500);
    expect(await seconds()).toBe(held);
    await viewer.mouse.up();
    await expect.poll(seconds, { timeout: CLIENT_FOLLOWS_MS }).toBeGreaterThan(held);
    await expect(viewer.getByTestId("replay-play")).toHaveAttribute("aria-label", "Pause");

    // End, from the focused bar, lands on the last frame: the end card, with
    // the bar still there to drag back into the race.
    await bar.focus();
    await viewer.keyboard.press("End");
    await expect(viewer.getByTestId("replay-watch-again")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
    await expect(bar).toBeVisible();

    const back = await along(0.1);
    await viewer.mouse.click(back.x, back.y);
    await expect(viewer.getByTestId("replay-watch-again")).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
    const landed = await seconds();
    expect(landed).toBeLessThanOrEqual(Math.ceil(length * 0.1) + 1);
    await expect.poll(seconds, { timeout: CLIENT_FOLLOWS_MS }).toBeGreaterThan(landed);

    // Every seek re-simulated exactly: no check disagreed on the way.
    await expect(viewer.getByTestId("replay-drift")).toHaveCount(0);
    await viewer.keyboard.press("Escape");
    await expectScreen(viewer, "game-end");
  });

  test("the arrows follow and Space pauses with a button focused, in the running app (D-R3, B8)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { pages } = await finishRace(browser);
    const viewer = pages[0]!;
    await watch(viewer);
    const name = viewer.getByTestId("replay-follow-name");
    const first = await name.textContent();
    await viewer.keyboard.press("ArrowRight");
    await expect(name).not.toHaveText(first!);
    // The follow can take longer than the bar's 2.5 s idle on a busy runner,
    // and a bar that has stepped aside lets the click through to the canvas
    // (the Mac runner, 2026-10-11). A pointer move brings it back first.
    await viewer.mouse.move(200, 200);
    await viewer.mouse.move(210, 200);
    await expect(viewer.getByTestId("replay-controls")).toHaveAttribute("data-idle", "false");
    // A click leaves Restart focused; Space must pause, never restart.
    await viewer.getByTestId("replay-restart").click();
    await viewer.keyboard.press(" ");
    await expect(viewer.getByTestId("replay-play")).toHaveAttribute("aria-label", "Play");
    await viewer.keyboard.press("Escape");
    await expectScreen(viewer, "game-end");
  });

  test("exits to the ready room once someone else has pressed Race again", async ({ browser }) => {
    test.setTimeout(120_000);
    const { pages } = await finishRace(browser);
    const [viewer, other] = pages as [Page, Page];
    await watch(viewer);
    await other.getByTestId("race-again").click();
    // The other client's Race again crosses the room and a patch before the
    // viewer hears it; two WebKit pages on one machine take longer than 5 s.
    await expect(viewer.getByTestId("replay-room-moved")).toHaveText("Your room is back in the ready room", { timeout: CLIENT_FOLLOWS_MS });
    // Escape: the replay may already hold on its last frame, where Back to
    // results replaces Exit; both leave for the room once it has moved on.
    await viewer.keyboard.press("Escape");
    await expectScreen(viewer, "lobby");
  });

  test("leaves from the held last frame by Back to results", async ({ browser }) => {
    test.setTimeout(180_000);
    const { pages } = await finishRace(browser);
    const viewer = pages[0]!;
    await watch(viewer);
    await viewer.keyboard.press("s");
    await expect(viewer.getByTestId("replay-back")).toBeVisible({ timeout: 90_000 });
    await expect(viewer.getByTestId("replay-exit")).toHaveCount(0);
    await viewer.getByTestId("replay-back").click();
    await expectScreen(viewer, "game-end");
  });

  test("five open, watch and exit cycles leak nothing", async ({ browser }) => {
    test.setTimeout(240_000);
    const { pages } = await finishRace(browser);
    const viewer = pages[0]!;
    // Escape leaves whether the bar shows Exit or, once the replay has held
    // on its last frame, Back to results: a slow engine can reach the end
    // before the test presses anything.
    const leave = async (): Promise<void> => {
      await viewer.keyboard.press("Escape");
      await expectScreen(viewer, "game-end");
    };
    await watch(viewer);
    await leave();
    const baseline = await readCounters(viewer);
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await watch(viewer);
      await leave();
    }
    // A leak grows: nothing may be above its baseline, and the GPU-side counts
    // must be exactly back. Audio sources may be fewer, since a Results cue
    // still sounding at the baseline ends during the cycles. They are polled
    // rather than read once: a cue from the last replay can still be ringing
    // as Results comes back on a loaded machine, and it ends; a leaked source
    // never does.
    await expect
      .poll(async () => (await readCounters(viewer)).audioSources, { timeout: CLIENT_FOLLOWS_MS, message: "audio sources settle at or below baseline" })
      .toBeLessThanOrEqual(baseline.audioSources);
    const after = await readCounters(viewer);
    expect(after.displayObjects).toBe(baseline.displayObjects);
    expect(after.veilCanvases).toBe(baseline.veilCanvases);
    expect(after.glContexts).toBe(baseline.glContexts);
    expect(after.previewSources).toBeLessThanOrEqual(baseline.previewSources);
    expect(after.replaySimulations).toBe(0);
  });
});
