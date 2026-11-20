import * as m from "../../apps/client/src/paraglide/messages.js";
import { expect, test, type Page } from "./support/test";
import { authoredStepKinds } from "./support/tutorial-walk";
import { FakePad, focusedTestId } from "./support/fake-gamepad";
import { readCounters } from "./support/inspection";
import {
  CLIENT_FOLLOWS_MS,
  createRoom,
  expectScreen,
  joinRoom,
  openClients,
  openTitle,
  passSplash,
  readyAll,
} from "./support/room-driver";
import { holdRoomClocks, waitForServer } from "./support/server-fixture";

/**
 * The phase 2 gate (launch polish spec §3.1.7): the whole shell, end to end,
 * against the real server. Title to race to pause and back; the title walked
 * by keyboard and by pad; the tutorial and the leaks it could leave; quality
 * switched back and forth; and a reload in the middle of a race.
 */

test.beforeAll(async () => {
  await waitForServer();
});

/**
 * Two clients in one room, racing. Returns them host first, and the room code. With
 * `holdCountdown`, the room's countdown is held (server `clock-hold.ts`), so the
 * race screen stays up as long as the spec needs it: on a slow machine two idle
 * racers were out of a survival race (0:19) before the spec reached its next
 * step, and the results took the screen from under the pause menu.
 */
async function raceOfTwo(browser: import("@playwright/test").Browser, options: { holdCountdown?: boolean } = {}): Promise<[Page, Page, string]> {
  const [a, b] = (await openClients(browser, 2)) as [Page, Page];
  const code = await createRoom(a, "Alpha");
  if (options.holdCountdown === true) await holdRoomClocks(code, ["countdown"]);
  await joinRoom(b, code, "Bravo");
  await readyAll([a, b]);
  await expectScreen(a, "gameplay");
  await expectScreen(b, "gameplay");
  return [a, b, code];
}

async function closeAll(pages: Page[]): Promise<void> {
  for (const page of pages) await page.context().close();
}

test("title to lobby to race, paused while the race goes on, then left for the title", async ({ browser }) => {
  test.slow();
  const [a, b, code] = await raceOfTwo(browser, { holdCountdown: true });
  try {
    await a.keyboard.press("Escape");
    const overlay = a.getByTestId("pause-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("Race continues");

    // The pause is one player's, never the room's: B's world keeps moving.
    // The countdown is let go now, so the race starts under A's pause menu.
    await holdRoomClocks(code, []);
    // Read until B's next frame, not after a fixed half second: software
    // WebGL draws one frame a second, so half a second can hold none.
    const first = await b.screenshot();
    await expect
      .poll(async () => Buffer.compare(first, await b.screenshot()), { message: "B's canvas froze while A was paused", timeout: 10_000 })
      .not.toBe(0);

    await a.getByTestId("pause-leave").click();
    await a.getByTestId("pause-leave-confirm").click();
    await expectScreen(a, "title");
  } finally {
    await closeAll([a, b]);
  }
});

test("the title walks in one order by keyboard, and a pad opens and closes Settings", async ({ page }, testInfo) => {
  const pad = await FakePad.install(page);
  await openTitle(page);

  const seen: string[] = [];
  for (let presses = 0; presses < 16; presses += 1) {
    await page.keyboard.press("Tab");
    const id = await focusedTestId(page);
    if (id !== null) seen.push(id);
  }
  for (const id of ["title-play", "title-settings", "quick-tutorial", "quick-contact", "corner-mute"]) {
    expect(seen, `Tab never reached ${id}`).toContain(id);
  }
  expect(seen.indexOf("title-play")).toBeLessThan(seen.indexOf("title-settings"));

  // The pad on a phone is a controller over a touch layout nobody holds.
  test.skip(testInfo.project.name !== "desktop", "the controller walk runs on desktop only");
  await pad.connect();
  await pad.walkTo("title-settings", "dpad");
  await pad.tap("south");
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await pad.tap("east");
  await expect(page.getByTestId("settings-modal")).toBeHidden();
});

test("the tutorial teaches its first step, exits to the title, and leaves nothing behind", async ({ page }) => {
  test.slow();
  await openTitle(page);
  // Settled first: the title's backdrop and racers are still arriving for a moment.
  await page.waitForTimeout(1_000);
  // The count includes cues still ringing (`liveSources` in managers/audio.ts):
  // a fresh title measured 3 or 4 for its first two seconds, with brief
  // plateaus, then a steady 2 once the splash tap's cues ended. A baseline
  // taken early is high, and the title reads "fewer" on the way back. So it is
  // taken once three samples in a row, a second and a half apart end to end,
  // agree.
  let before = await readCounters(page);
  let agreeing = 0;
  await expect
    .poll(
      async () => {
        const now = await readCounters(page);
        agreeing = now.audioSources === before.audioSources ? agreeing + 1 : 0;
        before = now;
        return agreeing >= 2;
      },
      { intervals: [750], timeout: 15_000 },
    )
    .toBe(true);
  // A title that drew nothing would make the comparison vacuous.
  expect(before.displayObjects).toBeGreaterThan(0);

  await page.getByTestId("quick-tutorial").click();
  await expectScreen(page, "tutorial");
  // The race loads under the screen first; the prompt is its end.
  await expect(page.getByTestId("tutorial-prompt")).toBeVisible({ timeout: 20_000 });
  // On touch the swipe coach is its own first-run card, over the first step.
  const coach = page.getByTestId("swipe-coach-dismiss");
  if (await coach.isVisible().catch(() => false)) await coach.click();
  // The prompt is the slim toast in every layout, which counts "1/5"
  // (TutorialPrompt.svelte). The count is the authored steps'.
  const total = authoredStepKinds().length;
  await expect(page.getByTestId("tutorial-step")).toContainText(m.tutorial_step_toast({ step: 1, total }));
  // Each step waits, frozen, for the player: the first key lifts the veil,
  // and the step clears once both ways have been steered.
  // A press inside the step's minimum freeze is not taken, and a held key is
  // not a fresh press after it, so press again until the veil lifts.
  // A press is fresh only if a tick saw the key up first (`observeFrozen` in
  // packages/shared/src/level/tutorial.ts), so the release is held for a few
  // ticks; released and pressed back to back, every retry read as one hold.
  await expect(async () => {
    await page.keyboard.up("KeyA");
    await page.waitForTimeout(100);
    await page.keyboard.down("KeyA");
    await expect(page.getByTestId("tutorial-freeze")).toBeHidden({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.keyboard.up("KeyA");
  await page.keyboard.down("KeyD");
  // The run is stepped by the render clock, at most five ticks a frame
  // (`MAX_STEPS_PER_FRAME` in tutorial-run.ts), and the rest of a long frame is
  // dropped. So both the clear and the 1.1 s the "Nice." stands (66 ticks) take
  // as long as the frames do: a few seconds on a loaded GPU runner, where
  // Playwright's 5 s default timed out once ("1 of 5" still showing). The page
  // is following the run, so the waits name how long a page may take to follow.
  await expect(page.getByTestId("tutorial-cleared")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  await page.keyboard.up("KeyD");
  await expect(page.getByTestId("tutorial-step")).toContainText(m.tutorial_step_toast({ step: 2, total }), { timeout: CLIENT_FOLLOWS_MS });

  await page.keyboard.press("Escape");
  await page.getByTestId("pause-leave").click();
  await expectScreen(page, "title");
  await expect.poll(async () => (await readCounters(page)).displayObjects, { timeout: 10_000 }).toBe(before.displayObjects);
  await expect.poll(async () => (await readCounters(page)).audioSources, { timeout: 10_000 }).toBe(before.audioSources);
});

test("switching quality back and forth leaks no display objects", async ({ page }) => {
  await openTitle(page);
  await page.waitForTimeout(1_000);
  const before = await readCounters(page);
  // A title that drew nothing would make the comparison vacuous.
  expect(before.displayObjects).toBeGreaterThan(0);

  await page.getByTestId("title-settings").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  for (let round = 0; round < 3; round += 1) {
    await page.getByTestId("settings-quality-low").check();
    await page.getByTestId("settings-quality-high").check();
  }
  await page.getByTestId("modal-close").click();

  await expect.poll(async () => (await readCounters(page)).displayObjects, { timeout: 10_000 }).toBe(before.displayObjects);
});

test("a reload mid-race puts the player back in the race, in the same seat", async ({ browser }) => {
  test.slow();
  const [a, b] = await raceOfTwo(browser);
  try {
    await a.reload();
    // The splash still asks for its tap: it is the gesture that unlocks sound.
    await passSplash(a);
    await expectScreen(a, "gameplay", 20_000);

    // B still races against A's seat, and not as a ghost held for a reconnect.
    await expect
      .poll(async () => {
        const rows = b.getByTestId("hud-row");
        if ((await rows.count()) > 0) {
          if ((await rows.count()) !== 2) return "seats";
          return (await b.locator("[data-testid='hud-row'][data-seat='0']").getAttribute("data-status")) ?? "none";
        }
        return (await b.getByTestId("hud-standings-line").count()) === 1 ? "racing" : "seats";
      }, { timeout: 20_000 })
      .not.toMatch(/^(seats|ghost|none)$/);
  } finally {
    await closeAll([a, b]);
  }
});
