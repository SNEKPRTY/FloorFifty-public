import { expect, test, type Page } from "./support/test";
import { FakePad, focusedTestId } from "./support/fake-gamepad";
import { readCounters } from "./support/inspection";
import {
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
 * by keyboard and by pad; quality
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
  for (const id of ["title-play", "title-settings", "quick-contact", "corner-mute"]) {
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
