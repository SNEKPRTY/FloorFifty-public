import { expect, test, type Page } from "./support/test";
import {
  RESULTS_TIMEOUT_MS,
  createRoom,
  expectScreen,
  joinRoom,
  enterLobby,
  openClient,
  openTitle,
  readyAll,
  seedProgress,
} from "./support/room-driver";
import { driveRoom, waitForServer } from "./support/server-fixture";

/**
 * Desktop does not change (responsive parity spec §8).
 *
 * The DOM chrome is compared against a baseline taken before phase 1d touched
 * anything. The canvas is hidden rather than masked: it fills the screen, and
 * a mask would cover the chrome drawn over it. It is hidden with a style tag
 * on the page, not `toHaveScreenshot`'s `style` option: headed Chromium keeps
 * painting the WebGL canvas's composited layer under that option, which left
 * the race frame never stable. What varies from run to run --
 * the room code, the clock, the progress bars, who happened to win, the
 * name field's drawn placeholder -- is masked, so a difference is a layout difference.
 */

// Survival's live danger shading is scenery too. It can rise while a slow
// screenshot settles, even though the WebGL canvas itself is already hidden.
const HIDE_CANVAS = 'canvas, [data-testid="survival-vignette"] { visibility: hidden !important; }';
// 900 x 600 is desktop too (width >= height, height >= 500), but narrower
// than the `lg:` breakpoint today's two-column menu sits behind. It holds the
// stacked layout a small desktop window has now.
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 900, height: 600 },
] as const;

// Patience, not tolerance: `toHaveScreenshot` captures until two frames agree,
// and the race HUD is taken during a live race. At 1440 x 900 on the Windows
// runner, beside three other workers, two agreeing captures took longer than
// the default 5 s. The comparison itself is unchanged.
const shot = (page: Page, name: string, mask: ReturnType<Page["locator"]>[] = []) =>
  expect(page).toHaveScreenshot(name, { mask, maxDiffPixelRatio: 0.001, timeout: 15_000 });

// The baselines are the Mac's alone: font rasterisation differs on Windows,
// and keeping a second set from the runner cost a round trip per change.
test.skip(process.platform !== "darwin", "desktop-guard's baselines are the Mac's; run it locally");

test.beforeAll(async () => {
  await waitForServer();
});

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;
  test.describe(`desktop at ${tag}`, () => {
    test.use({ viewport: size });

    test(`menu, ready room, race HUD and results are unchanged at ${tag}`, async ({ page, browser }) => {
      test.slow();
      // A fresh device earns Crash Mode on its first race, and results would
      // wear the unlock banner. The guard is about the screens, so this device
      // has already earned and seen Crash Mode and Pyramid Scheme.
      await seedProgress(page.context(), {
        unlocked: ["any-match", "games-2"],
        revealed: ["song:crash-mode", "song:pyramid-scheme"],
      });
      await openTitle(page);
      await page.addStyleTag({ content: HIDE_CANVAS });
      await page.evaluate(() => document.fonts.ready);
      await shot(page, `title-${tag}.png`);
      // The lobby, which the menu shot has been since the title/lobby split.
      await enterLobby(page);
      // The name field's placeholder is the racer name an empty field gets,
      // drawn at random each visit.
      await shot(page, `menu-${tag}.png`, [page.getByTestId("name-input")]);

      const guestContext = await browser.newContext();
      const guest = await guestContext.newPage();
      await openClient(guest);
      const code = await createRoom(page, "Kite");
      await joinRoom(guest, code, "Sable");
      // The guest's join is confirmed on the guest's page. Wait for the host's
      // page to show it too: `toHaveScreenshot` waits for a stable frame, not
      // the right one, and would freeze a room with one seat taken.
      await expect(page.getByTestId("seat-name").nth(1)).toHaveText("Sable");
      // The code is random, and its glyphs set its width. At 900 x 600 the row
      // around it shrinks to fit, so the row's mask was 328 px wide in one run
      // and 340 px in the next. The shot shows a fixed code of the same length
      // instead (the room has its real code; only the drawn text changes, and
      // nothing reads it again: `code` above is already taken). The row stays
      // masked as before.
      await page.getByTestId("room-code").evaluate((element, length) => {
        element.textContent = "0".repeat(length);
      }, code.length);
      await shot(page, `ready-room-${tag}.png`, [
        page.getByTestId("room-code").locator(".."),
        // The showcase's character idles on a timer, not a CSS animation the
        // capture can freeze, so its frame differs from shot to shot.
        page.getByTestId("stage-sprite"),
        page.getByTestId("menu-status"),
      ]);

      await readyAll([page, guest]);
      await expectScreen(page, "gameplay");
      await expect(page.getByTestId("race-hud")).toBeVisible();
      // Past 3 · 2 · 1 · GO, which a shot otherwise catches or misses by chance.
      // It may be running, done, or yet to show when the HUD appears, so the
      // shot waits until it has been gone longer than 3 · 2 · 1 and GO last.
      await page.waitForFunction(
        () => {
          const now = performance.now();
          const seen = window as unknown as { ffCountSeen?: number };
          if (seen.ffCountSeen === undefined || document.querySelector('[data-testid="race-count"]') !== null) seen.ffCountSeen = now;
          return now - seen.ffCountSeen > 3_700;
        },
        undefined,
        { polling: 100, timeout: 20_000 },
      );
      await shot(page, `race-hud-${tag}.png`, [
        // Finite elapsed time and Survival remaining time are separate elements.
        page.getByTestId("hud-timer"),
        page.getByTestId("hud-clock"),
        page.getByTestId("hud-floors"),
        page.getByTestId("hud-row"),
      ]);

      await driveRoom(code);
      await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
      // Shot once the replay has arrived, so "Replay unavailable" never
      // decides the frame. Race again, Watch replay and Return to menu share
      // one row; Mute is the corner's (UI layout spec §6.8).
      await expect(page.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
      const tops = await Promise.all(
        ["race-again", "watch-replay", "return-to-menu"].map(async (id) => (await page.getByTestId(id).boundingBox())!.y),
      );
      expect(Math.max(...tops) - Math.min(...tops), `action row tops ${tops.join(", ")}`).toBeLessThan(8);
      await shot(page,`results-${tag}.png`, [page.getByTestId("winner"), page.getByTestId("result-row")]);

      await guestContext.close();
    });
  });
}
