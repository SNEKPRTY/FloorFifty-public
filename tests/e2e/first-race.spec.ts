/**
 * A new player's first race, in a browser (first-race spec parts 2 to 5).
 *
 * A lone quick-match racer races CPUs. The words come from the compiled
 * message catalogue, so this spec holds no English and a reworded line changes
 * one catalogue. Each test starts from empty storage, as a first visit does.
 *
 * Keyboard play, so the `desktop` project only: on a phone the first race's
 * words and hints are the touch ones (the swipe coach, "Tap to start"), which
 * the unit tests cover and the fit walk looks at.
 */
import * as m from "../../apps/client/src/paraglide/messages.js";
import { expect, test, type Page } from "./support/test";
import { driveRoom, waitForServer } from "./support/server-fixture";
import {
  CLIENT_FOLLOWS_MS,
  RESULTS_TIMEOUT_MS,
  SCREEN_SETTLE_MS,
  chooseMode,
  expectNoOverlap,
  expectScreen,
  findRace,
  openClients,
  passSelect,
} from "./support/room-driver";

// Public rooms are shared by whoever finds a race, so these run one at a time.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await waitForServer();
});

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "keyboard play: the touch first race is covered by the unit tests and the fit walk");
});

/** A lone quick-match racer in a race against CPUs, in the default mode unless one is named. */
async function raceCpus(page: Page, options: { mode?: string } = {}): Promise<string> {
  const code = await findRace(page, "Kite");
  if (options.mode !== undefined) await chooseMode(page, options.mode);
  await page.getByTestId("ready-toggle").click();
  await expect(page.getByTestId("select-screen")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
  await passSelect([page]);
  await expectScreen(page, "gameplay");
  return code;
}

const clockSeconds = async (page: Page): Promise<number> => {
  const [minutes = 0, seconds = 0] = ((await page.getByTestId("hud-clock").textContent()) ?? "0:00").trim().split(":").map(Number);
  return minutes * 60 + seconds;
};

/**
 * Waits for the race to be `secondsIn` seconds old, counted from the clock's
 * reading at GO (`atGo`, read before anything else is asserted: a slow page
 * lets the clock run on while the assertions wait). In Survival the clock shows
 * time left, not time gone (`hud-model.ts`), so "12 seconds in" is the clock
 * reading 12 below that, 2:48 on the default 3 minutes. The bound is the
 * page's own pace: a software-rendered page draws well under real time.
 */
async function clockReads(page: Page, { atGo, secondsIn }: { atGo: number; secondsIn: number }): Promise<void> {
  await expect.poll(() => clockSeconds(page), { timeout: 150_000 }).toBeLessThanOrEqual(atGo - secondsIn);
}

test("an idle player in the default race is asked to press, still stands 12 s in, and is told why she is out", async ({ browser }) => {
  // The race is half a minute old before she is out, on a page that may draw slowly.
  test.setTimeout(360_000);
  const [page] = await openClients(browser, 1);
  await raceCpus(page!);
  const atGo = await clockSeconds(page!);
  await expect(page!.getByTestId("start-prompt")).toHaveText(m.race_start_press());
  await expect(page!.getByTestId("race-hint")).toHaveText(m.race_hint_edge());
  await expectNoOverlap(page!, '[data-testid="start-prompt"]', '[data-testid="race-hint"]');
  // Before this, a player who pressed nothing was out at 0:11.
  await clockReads(page!, { atGo, secondsIn: 12 });
  await expect(page!.getByTestId("out-banner")).toHaveCount(0);
  // Read in one go, on the frame OUT! first shows: the race ends a few seconds
  // after she goes out, and a page that draws slowly would otherwise be on the
  // Results screen by the next assertion.
  const out = await page!.waitForFunction(
    () => {
      const box = (id: string) => document.querySelector(`[data-testid="${id}"]`);
      const banner = box("out-banner");
      if (banner === null) return null;
      const rect = (element: Element | null) => element?.getBoundingClientRect().toJSON() as DOMRect | undefined;
      return {
        line: box("out-line")?.textContent?.trim(),
        prompts: document.querySelectorAll('[data-testid="start-prompt"]').length,
        hints: document.querySelectorAll('[data-testid="race-hint"]').length,
        banner: rect(banner),
        lineBox: rect(box("out-line")),
      };
    },
    undefined,
    { timeout: 150_000, polling: 100 },
  );
  const seen = (await out.jsonValue()) as { line?: string; prompts: number; hints: number; banner: DOMRect; lineBox?: DOMRect };
  expect(seen.line).toBe(m.race_out_line());
  expect(seen.prompts, "the prompt goes when she is out").toBe(0);
  expect(seen.hints, "so does the hint").toBe(0);
  expect(seen.lineBox, "the reason sits under the word").toBeDefined();
  expect(seen.lineBox!.top, "the reason does not overlap OUT!").toBeGreaterThanOrEqual(seen.banner.bottom - 1);
  await page!.context().close();
});

test("Space, a key the game does not bind, starts her: the prompt goes", async ({ browser }) => {
  const [page] = await openClients(browser, 1);
  await raceCpus(page!);
  await expect(page!.getByTestId("start-prompt")).toBeVisible();
  await page!.keyboard.press("Space");
  await expect(page!.getByTestId("start-prompt")).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
  await page!.context().close();
});

test("her first steer takes the prompt away, and the lava line is not shown in her second race", async ({ browser }) => {
  test.slow();
  const [page] = await openClients(browser, 1);
  const code = await raceCpus(page!);
  // Pressed after GO, on the prompt: the room takes input in the countdown but
  // steps the race only after it, so a tap that ends inside the countdown is
  // neutral at GO and never starts her. (Held on a fast page it is the prompt
  // going that proves she started; before GO there is no prompt to go.) Then
  // held until the prompt goes, as a finger holds a key: a press and release
  // inside one tick is never sampled either.
  await expect(page!.getByTestId("start-prompt")).toBeVisible();
  await page!.keyboard.down("ArrowRight");
  await expect(page!.getByTestId("start-prompt")).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
  await page!.keyboard.up("ArrowRight");
  // The hint stays six seconds after her first input and is then spent: the
  // device remembers it. Waited on by the saved flag, not by the hint going,
  // because a hint also goes when she is out, and that spends nothing.
  await expect
    .poll(() => page!.evaluate(() => JSON.parse(window.localStorage.getItem("floor-fifty.settings.v1") ?? "{}").seen?.edgeLine === true), {
      message: "the lava line is marked seen once it has run (she was not out first)",
      timeout: 60_000,
    })
    .toBe(true);
  await expect(page!.getByTestId("race-hint")).toHaveCount(0);
  const outcome = await driveRoom(code, { ticks: 60 * 240 });
  expect(outcome.phase, "the driver finishes the race").toBe("finished");
  await expectScreen(page!, "game-end", RESULTS_TIMEOUT_MS);
  await page!.getByTestId("race-again").click();
  await expectScreen(page!, "lobby");
  await page!.getByTestId("ready-toggle").click();
  await passSelect([page!]);
  await expectScreen(page!, "gameplay");
  await expect(page!.getByTestId("start-prompt")).toBeVisible();
  await expect(page!.getByTestId("race-hint")).toHaveCount(0);
  await page!.context().close();
});

test("a first 20-floor race teaches the floors, then the restart", async ({ browser }) => {
  test.slow();
  const [page] = await openClients(browser, 1);
  await raceCpus(page!, { mode: "floors-20" });
  await expect(page!.getByTestId("race-hint")).toHaveAttribute("data-hint", "floors");
  // The prompt is Survival's: a climb has no edge to wait on.
  await expect(page!.getByTestId("start-prompt")).toHaveCount(0);
  await page!.keyboard.down("ArrowRight");
  await expect(page!.getByTestId("race-hint")).toHaveAttribute("data-hint", "restart", { timeout: 12_000 });
  await page!.keyboard.up("ArrowRight");
  await page!.context().close();
});

test("the replay of a Survival race shows no start prompt", async ({ browser }) => {
  test.slow();
  const [page] = await openClients(browser, 1);
  const code = await raceCpus(page!);
  const outcome = await driveRoom(code, { ticks: 60 * 240 });
  expect(outcome.phase, "the driver finishes the race").toBe("finished");
  await expectScreen(page!, "game-end", RESULTS_TIMEOUT_MS);
  await expect(page!.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
  await page!.getByTestId("watch-replay").click();
  await expect(page!.getByTestId("hud-replay")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  await expect(page!.getByTestId("start-prompt")).toHaveCount(0);
  await expect(page!.getByTestId("race-hint")).toHaveCount(0);
  await page!.context().close();
});
