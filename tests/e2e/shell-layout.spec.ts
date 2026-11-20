import { expect, test, type Page } from "./support/test";
import { expectApart, expectReachable } from "./support/layout";
import { chooseMode, createRoom, expectScreen, openTitle, passPhotosensitivity, passSelect, RESULTS_TIMEOUT_MS } from "./support/room-driver";
import { driveRoom, waitForServer } from "./support/server-fixture";

/**
 * Phase 2's shell controls inside the accepted compositions (launch polish
 * §3.1.1, responsive parity §4): the pause button, Back and the corner mutes
 * sit in a slot of their own on every form factor, and the swipe surface
 * leaves what phase 1d made tappable alone.
 *
 * At the default settings, so a touch form factor steers by swipe (D6): the
 * layout sweep seeds the buttons, which is how the swipe surface's collisions
 * went unseen. One seat, because none of this depends on who else is in the
 * room. Soft throughout, so one collision never hides the next screen's.
 */

type View = { width: number; height: number; touch: boolean; portrait: boolean };

const VIEWS: readonly View[] = [
  { width: 390, height: 844, touch: true, portrait: true },
  { width: 360, height: 640, touch: true, portrait: true },
  { width: 844, height: 390, touch: true, portrait: false },
  // Smallest supported full-screen landscape phone (owner, 2026-10-16).
  { width: 667, height: 375, touch: true, portrait: false },
  { width: 1280, height: 720, touch: false, portrait: false },
  { width: 820, height: 1180, touch: true, portrait: true },
];

/** Padding, in CSS px, at the left of an element. */
const paddingLeft = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((node) => parseFloat(getComputedStyle(node).paddingLeft));

test.beforeAll(async () => {
  await waitForServer();
});

for (const view of VIEWS) {
  test(`shell controls keep their own place at ${view.width}x${view.height}`, async ({ browser }) => {
    test.slow();
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      hasTouch: view.touch,
      isMobile: view.touch,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      // The splash sets the wordmark as the menus do: stacked, two lines.
      await page.goto("/");
      await passPhotosensitivity(page);
      const splashWordmark = page.getByTestId("splash").locator("h1");
      await expect(splashWordmark).toBeVisible();
      const lines = await splashWordmark.evaluate(
        (node) => node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).fontSize),
      );
      expect.soft(lines, "the splash wordmark is on one line").toBeGreaterThan(1.6);

      await openTitle(page);
      await page.evaluate(() => document.fonts.ready);

      // The title and the lobby share one hero (responsive parity §3.4): the
      // same ledge, at the same scale, on every form factor.
      const titleLedge = await page.getByTestId("menu-ledge").boundingBox();

      // The title: every choice on screen, none left below the fold.
      for (const id of ["title-play", "title-settings", "quick-contact", "corner-mute"]) {
        await expectReachable(page, id);
      }
      // The quick actions keep their words: a narrow screen wraps them onto a second row, never to bare icons.
      const quickWords = await page.locator('[role="toolbar"][aria-label="Quick actions"] [data-action-bar] [data-row="visible"] > button').evaluateAll((nodes) =>
        nodes.map((node) => (node.textContent ?? "").trim()),
      );
      expect.soft(quickWords.every((word) => word.length > 0), `a quick action lost its word: ${quickWords.join(", ")}`).toBe(true);

      // The Controls tab names a controller's buttons on one line each. A line
      // is counted from the text's own boxes: a tablet's UI zoom makes a
      // one-line keycap taller than its unzoomed font size says.
      await page.getByTestId("title-settings").click();
      await page.getByTestId("settings-tab-controls").click();
      const wrapped = await page.locator('[data-controls-section="controller"] dt').evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            const tops = new Set<number>();
            for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
              const range = document.createRange();
              range.selectNodeContents(text);
              for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
            }
            return tops.size > 1;
          })
          .map((node) => node.textContent),
      );
      expect.soft(wrapped, "controller glyphs wrap").toEqual([]);
      await page.getByTestId("modal-close").click();

      // The lobby: Back and Mute clear of the wordmark and inside the sheet.
      await page.getByTestId("title-play").click();
      await expectScreen(page, "lobby");
      await expectReachable(page, "lobby-back");
      await expectReachable(page, "corner-mute");
      await expectApart(page, '[data-testid="lobby-back"]', '[data-testid="menu-wordmark"]');
      await expectApart(page, '[data-testid="corner-mute"]', '[data-testid="menu-wordmark"]');
      // The on-screen help is whole or not shown: never cut by the fold.
      const help = await page.locator(".ff-help-touch").evaluateAll((nodes) =>
        nodes
          .filter((node) => node.getBoundingClientRect().height > 0)
          .map((node) => node.getBoundingClientRect().bottom - window.innerHeight),
      );
      expect.soft(help.filter((overrun) => overrun > 0.5), "the touch help runs below the fold").toEqual([]);
      const lobbyLedge = await page.getByTestId("menu-ledge").boundingBox();
      expect.soft(
        { width: Math.round(titleLedge?.width ?? 0), height: Math.round(titleLedge?.height ?? 0) },
        "the title's ledge is the lobby's",
      ).toEqual({ width: Math.round(lobbyLedge?.width ?? 0), height: Math.round(lobbyLedge?.height ?? 0) });

      // The ready room: Copy and Mute both reachable, and the rotate hint
      // clear of Mute.
      const code = await createRoom(page, "Kite");
      // Rooms open on Survival (catalog order, 2026-10-13); the 20-floor race has every HUD chip and a restart.
      await chooseMode(page, "floors-20");
      await expectReachable(page, "copy-code");
      await expectReachable(page, "corner-mute");
      if (await page.getByTestId("rotate-hint").isVisible()) {
        await expectApart(page, '[data-testid="rotate-hint"]', '[data-testid="corner-mute"]');
      }

      // The race: the pause button clear of every HUD chip.
      await page.getByTestId("ready-toggle").click();
      await passSelect([page]);
      await expectScreen(page, "gameplay");
      await expect(page.getByTestId("race-hud")).toBeVisible();
      await expectReachable(page, "pause-open");
      // Sharing the row never squeezes a chip: each value on one line, inside
      // its chip ("02 /" over "20" at 360 px was the failure). A hint's toast
      // is a sentence that may take two lines, so only its width is checked.
      const squeezed = await page.locator('[data-testid="race-hud"] .ff-aq-hud').evaluateAll((chips) =>
        chips
          .filter((chip) => chip.scrollWidth > chip.clientWidth + 1 || (chip.classList.contains("ff-hud__chip") && [...chip.querySelectorAll("span")].some(
            (value) => value.getBoundingClientRect().height > parseFloat(getComputedStyle(value).fontSize) * 1.8,
          )))
          .map((chip) => (chip.textContent ?? "").trim()),
      );
      expect.soft(squeezed, "HUD chips squeezed").toEqual([]);
      for (const hud of ["hud-floors", "hud-timer", "hud-lap", "hud-roster"]) {
        if ((await page.getByTestId(hud).count()) > 0) {
          await expectApart(page, '[data-testid="pause-open"]', `[data-testid="${hud}"]`);
        }
      }

      if (view.touch) {
        // The coach is padded like every other panel: one spacing step is
        // one pixel here, not a quarter rem.
        if (await page.getByTestId("swipe-coach").isVisible()) {
          expect.soft(await paddingLeft(page, "swipe-coach"), "coach padding").toBeGreaterThanOrEqual(12);
          await page.getByTestId("swipe-coach-dismiss").click();
        }
        // Restart is the timer's tap on touch; nothing may cover it.
        await expectReachable(page, "hud-restart");
        // A phone held upright says its place in one line above the thumbs;
        // the press still reaches the swipe surface, so a steer can start
        // under it (owner, 2026-10-16).
        if (view.portrait && (await page.getByTestId("hud-standings-line").count()) > 0) {
          const line = page.getByTestId("hud-standings-line");
          await expect.soft(line, "the standings line is not visible").toBeVisible();
          const box = (await line.boundingBox())!;
          const under = await page.evaluate(
            ([x, y]) => document.elementFromPoint(x!, y!)?.closest("[data-testid]")?.getAttribute("data-testid"),
            [box.x + box.width / 2, box.y + box.height / 2],
          );
          expect.soft(under, "a press on the standings line reaches the swipe surface").toBe("swipe-surface");
        }
      }

      // The pause overlay: every choice without scrolling the dialog.
      await page.getByTestId("pause-open").click();
      for (const id of ["pause-resume", "pause-mute", "pause-settings", "pause-leave"]) {
        await expectReachable(page, id);
      }
      await page.getByTestId("pause-resume").click();

      // The results: Mute clear of the rows and the heading.
      await driveRoom(code);
      await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
      await expectReachable(page, "corner-mute");
      await expectApart(page, '[data-testid="corner-mute"]', '[data-testid="result-row"]');
      await expectApart(page, '[data-testid="corner-mute"]', '[data-testid="winner"]');
    } finally {
      await context.close();
    }
  });
}
