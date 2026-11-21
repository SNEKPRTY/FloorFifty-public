/**
 * The motion edges of the screens that moved onto the kit (shared-components spec, U3): one
 * `describe` per screen group, so groups merge without touching each other's lines. Each row is one
 * gap the animations audit found. It drives to the screen, makes the change, and reads what the
 * page did in that same turn: the leaving element is `inert` and still in the page, the arriving
 * one is mid-fade; then, a beat later, the arriving one is whole and the leaving one is gone. The
 * same row with reduced motion asks for the end state at once.
 *
 * Read in the page, in the turn of the click, not by timed screenshots: the frame cap in software
 * WebGL makes a 60 ms sample land anywhere. A transition's state is the page's, whatever the
 * frame rate.
 *
 * Desktop only: the race is played by keyboard here (see `first-race.spec.ts`).
 */
import { expect, test, type Browser, type Page } from "./support/test";
import { waitForServer } from "./support/server-fixture";
import {
  CLIENT_FOLLOWS_MS,
  SCREEN_SETTLE_MS,
  chooseMode,
  expectScreen,
  findRace,
  openClient,
  openClients,
  openTitle,
  passSelect,
} from "./support/room-driver";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await waitForServer();
});

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "keyboard play: the race is driven on the desktop project");
});

const MOTIONS = ["no-preference", "reduce"] as const;

/** A first race against CPUs for a lone quick-match racer, in the mode named. */
async function raceCpus(browser: Browser, motion: (typeof MOTIONS)[number], mode: string): Promise<Page> {
  const [page] = await openClients(browser, 1, undefined, { context: { reducedMotion: motion } });
  await findRace(page!, "Kite");
  await chooseMode(page!, mode);
  await page!.getByTestId("ready-toggle").click();
  await expect(page!.getByTestId("select-screen")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
  await passSelect([page!]);
  await expectScreen(page!, "gameplay");
  return page!;
}

/** What a pair of views looked like, read in the page. */
type Snap = { leavingInert: boolean; leavingPresent: boolean; arrivingOpacity: number; arrivingInert: boolean };

/**
 * Clicks `trigger`, and in the same turn reads the view that was showing (`leaving`) and the one
 * that replaces it (`arriving`), as selectors inside `scope`.
 */
async function crossFade(page: Page, trigger: string, scope: string, leaving: string, arriving: string): Promise<Snap | undefined> {
  return page.evaluate(
    async ([triggerId, scopeSel, leavingSel, arrivingSel]) => {
      const root = document.querySelector(scopeSel!)!;
      const old = root.querySelector<HTMLElement>(leavingSel!);
      document.querySelector<HTMLElement>(`[data-testid='${triggerId}']`)!.click();
      // Svelte patches the DOM in a microtask; the transition has started by the next turn.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const next = root.querySelector<HTMLElement>(arrivingSel!);
      if (old === null || next === null) return undefined;
      return {
        leavingInert: old.closest("[inert]") !== null,
        leavingPresent: old.isConnected,
        arrivingOpacity: Number(getComputedStyle(next).opacity),
        arrivingInert: next.closest("[inert]") !== null,
      };
    },
    [trigger, scope, leaving, arriving],
  );
}

for (const motion of MOTIONS) {
  test.describe(`race and story, motion ${motion}`, () => {
    test("pause: menu to settings to leave is a cross-fade, not a cut", async ({ browser }) => {
      test.slow();
      const page = await raceCpus(browser, motion, "floors-20");
      await page.getByTestId("pause-open").click();
      await expect(page.getByTestId("pause-overlay")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      // The two views of the action row: `menu`, then `settings`.
      const actions = '[data-testid="pause-overlay"] [data-modal-part="actions"]';
      const toSettings = await crossFade(page, "pause-settings", actions, '.ff-view[data-view="menu"]', '.ff-view[data-view="settings"]');
      expect(toSettings, "the menu and the settings view are both in the page when the change starts").toBeDefined();
      expect(toSettings!.arrivingInert, "the new view takes input at once").toBe(false);
      if (motion === "no-preference") {
        expect(toSettings!.leavingInert, "the old view is inert from its first frame").toBe(true);
        expect(toSettings!.leavingPresent, "the old view is still in the page, fading out").toBe(true);
        expect(toSettings!.arrivingOpacity, "the new view is mid-fade").toBeLessThan(1);
      } else {
        expect(toSettings!.arrivingOpacity, "reduced motion lands the new view at once").toBe(1);
      }
      // A beat later: the old view is gone and the new one is whole.
      await expect(page.locator(`${actions} .ff-view[data-view="menu"]`)).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
      await expect
        .poll(() => page.locator(`${actions} .ff-view[data-view="settings"]`).evaluate((node) => Number(getComputedStyle(node).opacity)), {
          timeout: CLIENT_FOLLOWS_MS,
        })
        .toBe(1);

      // The cross-fade must not cost the settings view its room: one scroller, and a list as tall as
      // it is without the switch (199 px in a 490 px dialog on main at 1280x720).
      const room = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('[data-testid="pause-overlay"] [data-modal-part="body"]')!;
        const list = document.querySelector<HTMLElement>('[data-testid="pause-overlay"] .ff-scroll-list__view')!;
        return { bodyScrolls: body.scrollHeight - body.clientHeight, listHeight: list.clientHeight };
      });
      expect(room.bodyScrolls, "the dialog body does not scroll as well").toBeLessThanOrEqual(1);
      expect(room.listHeight, "the language list has its room").toBeGreaterThanOrEqual(190);

      // Back to the menu, then to the leave question.
      await page.getByTestId("pause-settings-back").click();
      await expect(page.getByTestId("pause-leave")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      await expect(page.locator(`${actions} .ff-view`)).toHaveCount(1, { timeout: CLIENT_FOLLOWS_MS });
      const toLeave = await crossFade(page, "pause-leave", actions, '.ff-view[data-view="menu"]', '.ff-view[data-view="leave"]');
      expect(toLeave, "the menu and the leave question are both in the page when the change starts").toBeDefined();
      if (motion === "no-preference") {
        expect(toLeave!.leavingInert).toBe(true);
        expect(toLeave!.leavingPresent).toBe(true);
        expect(toLeave!.arrivingOpacity).toBeLessThan(1);
      } else {
        expect(toLeave!.arrivingOpacity).toBe(1);
      }
      await expect(page.getByTestId("pause-leave-confirm")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      await page.context().close();
    });

    test("a race hint rises in and falls out as the shared toast", async ({ browser }) => {
      test.slow();
      // The watcher is written before the page loads, so the hint is caught as it is added and as it leaves.
      const context = await browser.newContext({ reducedMotion: motion });
      await context.addInitScript(() => {
        const seen: Array<{ hint: string; event: "in" | "out"; opacity: number; inert: boolean }> = [];
        Object.assign(window, { __ffToasts: seen });
        const read = (toast: Element, event: "in" | "out"): void => {
          const hint = toast.querySelector('[data-testid="race-hint"]')?.getAttribute("data-hint");
          if (hint === null || hint === undefined) return;
          seen.push({ hint, event, opacity: Number(getComputedStyle(toast).opacity), inert: toast.closest("[inert]") !== null });
        };
        const watch = new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === "attributes" && record.attributeName === "inert") {
              const target = record.target as Element;
              if (target.classList.contains("ff-toast") && target.hasAttribute("inert")) read(target, "out");
            }
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              const toast = node.classList.contains("ff-toast") ? node : node.querySelector(".ff-toast");
              if (toast !== null) read(toast, "in");
            }
          }
        });
        const start = (): void => watch.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["inert"] });
        if (document.documentElement !== null) start();
        else document.addEventListener("DOMContentLoaded", start);
      });
      const page = await context.newPage();
      await openClient(page);
      await findRace(page, "Kite");
      await chooseMode(page, "floors-20");
      await page.getByTestId("ready-toggle").click();
      await expect(page.getByTestId("select-screen")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await passSelect([page]);
      await expectScreen(page, "gameplay");
      await expect(page.getByTestId("race-hint")).toHaveAttribute("data-hint", "floors");
      // Her first input starts the hint's six seconds, and "floors" gives way to "restart".
      await page.keyboard.down("ArrowRight");
      await expect(page.getByTestId("race-hint")).toHaveAttribute("data-hint", "restart", { timeout: 20_000 });
      // Six seconds on, the restart hint is spent and the toast falls out.
      await expect(page.getByTestId("race-hint")).toHaveCount(0, { timeout: 60_000 });
      await page.keyboard.up("ArrowRight");
      const seen = await page.evaluate(
        () => (window as unknown as { __ffToasts: Array<{ hint: string; event: "in" | "out"; opacity: number; inert: boolean }> }).__ffToasts,
      );
      const arrival = seen.find((entry) => entry.event === "in" && entry.hint === "floors");
      const leave = seen.find((entry) => entry.event === "out" && entry.hint === "restart");
      expect(arrival, "the floors hint was caught arriving").toBeDefined();
      if (motion === "no-preference") {
        expect(arrival!.opacity, "it rises in from nothing").toBeLessThan(1);
        expect(leave, "it was marked inert as it fell out, still in the page").toBeDefined();
        expect(leave!.inert).toBe(true);
      } else {
        expect(arrival!.opacity, "reduced motion lands it at once").toBe(1);
      }
      await page.context().close();
    });

    test("the story's words are a glass panel that rise in", async ({ browser }) => {
      test.slow();
      const context = await browser.newContext({ reducedMotion: motion });
      await context.addInitScript(() => {
        const seen: number[] = [];
        Object.assign(window, { __ffCards: seen });
        const watch = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue;
              const card = node.matches('[data-testid="story-line"], [data-testid="story-chip"]') ? node : node.querySelector('[data-testid="story-line"], [data-testid="story-chip"]');
              if (card !== null) seen.push(Number(getComputedStyle(card).opacity));
            }
          }
        });
        const start = (): void => watch.observe(document, { subtree: true, childList: true });
        if (document.documentElement !== null) start();
        else document.addEventListener("DOMContentLoaded", start);
      });
      const page = await context.newPage();
      await openTitle(page);
      await page.getByTestId("quick-story").click();
      await expectScreen(page, "story");
      await page.getByTestId("story-play").click({ timeout: 30_000 });
      await page.getByTestId("story-cutscene-skip").click({ timeout: 30_000 });
      await expect(page.getByTestId("story-line").or(page.getByTestId("story-chip")).first()).toBeVisible({ timeout: 20_000 });
      const card = page.getByTestId("story-line").or(page.getByTestId("story-chip")).first();
      // The words sit on the kit's HUD glass, and arrives by the kit's rise.
      await expect(card).toHaveClass(/ff-aq-hud/);
      await expect(card).toHaveClass(/ff-panel-arrive/);
      const seen = await page.evaluate(() => (window as unknown as { __ffCards: number[] }).__ffCards);
      expect(seen.length, "the first card was caught arriving").toBeGreaterThan(0);
      if (motion === "no-preference") expect(seen[0], "it rises in from nothing").toBeLessThan(1);
      else expect(seen[0], "reduced motion lands it at once").toBe(1);
      await context.close();
    });
  });
}
