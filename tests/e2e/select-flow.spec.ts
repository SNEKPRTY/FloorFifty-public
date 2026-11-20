import { devices, expect, test, type Page } from "./support/test";
import { readCounters } from "./support/inspection";
import {
  CLIENT_FOLLOWS_MS,
  SCREEN_SETTLE_MS,
  createRoom,
  expectScreen,
  holdClocks,
  joinRoom,
  lockStage,
  openClients,
  passSelect,
  passSplash,
  pressLockIn,
  readyOnly,
  turnPickerTo,
  RESULTS_TIMEOUT_MS,
} from "./support/room-driver";
import { driveRoom, waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

async function roomOfTwo(browser: import("@playwright/test").Browser): Promise<{ pages: [Page, Page]; code: string }> {
  const pages = (await openClients(browser, 2)) as [Page, Page];
  const code = await createRoom(pages[0], "Alpha");
  await joinRoom(pages[1], code, "Bravo");
  return { pages, code };
}

/*
 * These specs look at a pick step, or reload a page back into one, and a pick
 * step is 15 s of the room's clock. Reloading a page and tapping through its
 * splash takes a loaded machine longer than that, and so does a run of a dozen
 * waits for the room's other seat to show a pick: the nightly's four failures
 * of "a reload mid song step lands on the song step" were pages that came
 * back to the reveal and then the countdown, the step long gone. So each spec
 * asks the room to hold the clock of the step it inspects (`holdClocks`), and
 * lets it go before the race goes on. The room keeps ticking and the pages are
 * kept up to date; only the step's end stands still.
 */

/**
 * The song step's audio, read from the app's counters: never the menu theme
 * and a preview at once, and never more than one clip fading under the one
 * playing. Where this browser decodes the clips (AAC in an m4a), a preview is
 * playing too; where it does not, the unit tests own that proof.
 */
async function expectPreviewOnly(page: Page): Promise<void> {
  const aac = await page.evaluate(() => new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"') !== "");
  if (aac) {
    await expect.poll(async () => (await readCounters(page)).previewSources, { timeout: 5_000, message: "the song on screen previews" }).toBe(1);
  } else {
    test.info().annotations.push({ type: "note", description: "this browser decodes no AAC, so no preview sounds here" });
  }
  const now = await readCounters(page);
  expect(now.music && now.previewSources > 0, "the menu theme and a preview at once").toBe(false);
  expect(now.previewSources).toBeLessThanOrEqual(2);
}

test("two players pick a stage, see each other's cursors, and race the roulette's choice", async ({ browser }) => {
  test.slow();
  const { pages, code } = await roomOfTwo(browser);
  const [a, b] = pages;
  try {
    await holdClocks(a, ["stage"]);
    await readyOnly(pages);
    await expect(a.getByTestId("select-screen"), "the stage step opens").toHaveAttribute("data-step", "stage", { timeout: SCREEN_SETTLE_MS });
    // By the dot where there are dots; a phone held sideways shows "3 / 11" instead.
    await turnPickerTo(a, "sunken-dome");
    await expect(b.locator("[data-testid=player-row][data-seat='0']"), "B sees A on Sunken Dome").toContainText("Sunken Dome", { timeout: CLIENT_FOLLOWS_MS });
    await pressLockIn(a);
    await expect(b.locator("[data-testid=player-row][data-seat='0']"), "B sees A locked in").toContainText("Locked", { timeout: CLIENT_FOLLOWS_MS });
    await pressLockIn(b);
    await expect(a.getByTestId("roulette"), "the reveal runs").toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
    await expect(a.getByTestId("roulette-byline")).toHaveText(/^(Your pick|Picked by (Alpha|Bravo))$/, { timeout: CLIENT_FOLLOWS_MS });
    await passSelect(pages);
    await expectScreen(a, "gameplay");
    await expectScreen(b, "gameplay");
    const result = await driveRoom(code);
    expect(result.phase).toBe("finished");
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("a reload mid-select lands on the current step", async ({ browser }) => {
  test.slow();
  const { pages } = await roomOfTwo(browser);
  const [a, b] = pages;
  try {
    await holdClocks(a, ["stage"]);
    await readyOnly(pages);
    await expect(a.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: SCREEN_SETTLE_MS });
    // From the opening focus (Rooftops, slide 2), two slides on: Sunken Dome.
    await a.getByTestId("picker-next").click();
    await a.getByTestId("picker-next").click();
    // The room has heard it before the reload: the other player sees the flag move.
    await expect(b.locator("[data-testid=player-row][data-seat='0']"), "the room has A's pick").toContainText("Sunken Dome", { timeout: CLIENT_FOLLOWS_MS });
    await a.reload();
    // The splash still asks for its tap: it is the gesture that unlocks sound.
    await passSplash(a);
    await expect(a.getByTestId("select-screen"), "back on the select screen after a reload").toHaveAttribute("data-step", "stage", { timeout: SCREEN_SETTLE_MS });
    await expect(a.getByTestId("picker"), "the panel opens on the focus kept across the reload").toHaveAttribute("data-id", "sunken-dome", { timeout: SCREEN_SETTLE_MS });
    await holdClocks(a, []);
    await passSelect(pages);
    await expectScreen(a, "gameplay");
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("the primary action is in view on every step", async ({ browser }) => {
  test.slow();
  const { pages } = await roomOfTwo(browser);
  const [a] = pages;
  const fits = () =>
    a.evaluate(() => {
      const box = document.querySelector("[data-testid=lock-in]")!.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth && box.height >= 44;
    });
  try {
    await holdClocks(a, ["stage", "song"]);
    await readyOnly(pages);
    await expect(a.getByTestId("lock-in")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
    expect(await fits(), "Lock in on the stage step").toBe(true);
    await lockStage(pages);
    await expect(a.getByTestId("lock-in")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
    expect(await fits(), "Lock in on the song step").toBe(true);
    await holdClocks(a, []);
    await passSelect(pages);
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("two players pick a song while it previews, and race to the roulette's choice", async ({ browser }) => {
  test.slow();
  const { pages, code } = await roomOfTwo(browser);
  const [a, b] = pages;
  try {
    await holdClocks(a, ["song"]);
    await readyOnly(pages);
    await lockStage(pages);
    // The song step opens on the seat's first pickable song.
    await expect(a.getByTestId("picker"), "the song step opens on Moving On").toHaveAttribute("data-id", "moving-on", { timeout: CLIENT_FOLLOWS_MS });
    await expect(a.getByTestId("select-headline")).toHaveText("Moving On", { timeout: CLIENT_FOLLOWS_MS });
    await expect(a.getByTestId("song-slide-bpm"), "no tempo on the song card").toHaveCount(0);
    await expectPreviewOnly(a);

    // A locked song is on screen, says why, and moves nobody's pick.
    await turnPickerTo(a, "unseen");
    await expect(a.getByTestId("song-slide")).toHaveAttribute("data-state", "locked", { timeout: CLIENT_FOLLOWS_MS });
    await expect(a.getByTestId("lock-in")).toBeDisabled({ timeout: CLIENT_FOLLOWS_MS });
    await expect(b.locator("[data-testid=player-row][data-seat='0']"), "B still sees A on B's own pick: no other song named").not.toContainText(/Unseen/);
    await expect(b.locator("[data-testid=player-row][data-seat='1']"), "B's own row names Moving On").toContainText("Moving On");

    await turnPickerTo(b, "whats-next");
    await expect(a.locator("[data-testid=player-row][data-seat='1']"), "A sees B's song").toContainText(/What.s Next/, { timeout: CLIENT_FOLLOWS_MS });

    await turnPickerTo(a, "moving-on");
    await pressLockIn(a);
    await pressLockIn(b);
    await expect(a.getByTestId("select-screen"), "the song reveal runs").toHaveAttribute("data-step", "songReveal", { timeout: CLIENT_FOLLOWS_MS });
    await expect(a.getByTestId("roulette-byline")).toHaveText(/^(Your pick|Picked by (Alpha|Bravo))$/, { timeout: CLIENT_FOLLOWS_MS });
    await expect(a.getByTestId("roulette-result")).toHaveText(/^(Moving On|What.s Next)$/);
    await expectScreen(a, "gameplay");
    await expectScreen(b, "gameplay");
    const result = await driveRoom(code);
    expect(result.phase).toBe("finished");
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("a reload mid song step lands on the song step", async ({ browser }) => {
  test.slow();
  const { pages } = await roomOfTwo(browser);
  const [a, b] = pages;
  try {
    await holdClocks(a, ["song"]);
    await readyOnly(pages);
    await lockStage(pages);
    // From the opening focus (Moving On, slide 2), one slide on: Farther From Home.
    await a.getByTestId("picker-next").click();
    await expect(b.locator("[data-testid=player-row][data-seat='0']"), "the room has A's pick").toContainText("Farther From Home", { timeout: CLIENT_FOLLOWS_MS });
    await a.reload();
    // The splash still asks for its tap: it is the gesture that unlocks sound.
    await passSplash(a);
    await expect(a.getByTestId("select-screen"), "back on the song step after a reload").toHaveAttribute("data-step", "song", { timeout: SCREEN_SETTLE_MS });
    await expect(a.getByTestId("picker"), "the panel opens on the focus kept across the reload").toHaveAttribute("data-id", "farther-from-home", { timeout: SCREEN_SETTLE_MS });
    // Its preview starts again from the seat's own focus, and the menu theme the splash claimed is not under it.
    await expectPreviewOnly(a);
    await holdClocks(a, []);
    await passSelect(pages);
    await expectScreen(a, "gameplay");
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("paging through the songs fast never overlaps previews", async ({ browser }) => {
  test.slow();
  const { pages } = await roomOfTwo(browser);
  const [a] = pages;
  try {
    await holdClocks(a, ["song"]);
    await readyOnly(pages);
    await lockStage(pages);
    await expect(a.getByTestId("picker")).toHaveAttribute("data-id", "moving-on", { timeout: CLIENT_FOLLOWS_MS });
    await expectPreviewOnly(a);
    const samples: Awaited<ReturnType<typeof readCounters>>[] = [];
    // Three turns, each well inside the 250 ms debounce: Moving On to Chrome in the Rain.
    for (let turn = 0; turn < 3; turn += 1) {
      await a.getByTestId("picker-next").click();
      samples.push(await readCounters(a));
    }
    await expect(a.getByTestId("picker")).toHaveAttribute("data-id", "chrome-in-the-rain", { timeout: CLIENT_FOLLOWS_MS });
    for (let at = 0; at < 6; at += 1) {
      await a.waitForTimeout(150);
      samples.push(await readCounters(a));
    }
    expect(Math.max(...samples.map((sample) => sample.previewSources)), "one playing and one fading, at most").toBeLessThanOrEqual(2);
    expect(samples.some((sample) => sample.music && sample.previewSources > 0), "the menu theme under a preview").toBe(false);
    await expectPreviewOnly(a);
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("five rounds of ready, select, race and results return every counter to baseline", async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const { pages, code } = await roomOfTwo(browser);
  const [a, b] = pages;
  try {
    let before = await readCounters(a);
    let agreeing = 0;
    await expect
      .poll(
        async () => {
          const now = await readCounters(a);
          agreeing = now.audioSources === before.audioSources && now.displayObjects === before.displayObjects ? agreeing + 1 : 0;
          before = now;
          return agreeing >= 2;
        },
        { intervals: [750], timeout: 15_000, message: "the ready room settles" },
      )
      .toBe(true);

    for (let round = 0; round < 5; round += 1) {
      await readyOnly(pages);
      await passSelect(pages);
      await expectScreen(a, "gameplay");
      await driveRoom(code);
      await expectScreen(a, "game-end", RESULTS_TIMEOUT_MS);
      // Each player leaves the results themselves; the second's Race again
      // finds the room already in the lobby, and the screen still leaves.
      await a.getByTestId("race-again").click();
      await expectScreen(b, "game-end", RESULTS_TIMEOUT_MS);
      await b.getByTestId("race-again").click();
      await expectScreen(a, "lobby");
      await expectScreen(b, "lobby");
    }

    await expect.poll(async () => (await readCounters(a)).displayObjects, { timeout: 15_000, message: "display objects back to baseline" }).toBe(before.displayObjects);
    await expect.poll(async () => (await readCounters(a)).audioSources, { timeout: 15_000, message: "audio sources back to baseline" }).toBe(before.audioSources);
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("Lock in reads as enabled at a browser's height, on both steps (audit m9)", async ({ browser }) => {
  test.slow();
  const { pages } = await roomOfTwo(browser);
  const [a] = pages;
  const looksEnabled = async (page: Page, step: string) => {
    const lock = page.getByTestId("lock-in");
    await expect(lock, `${step}: Lock in is enabled`).toBeEnabled({ timeout: CLIENT_FOLLOWS_MS });
    const look = await lock.evaluate((node) => {
      const style = getComputedStyle(node);
      return { opacity: style.opacity, filter: style.filter, background: `${style.backgroundColor} ${style.backgroundImage}` };
    });
    expect(look.opacity, `${step}: ${JSON.stringify(look)}`).toBe("1");
    expect(look.filter, `${step}: ${JSON.stringify(look)}`).toBe("none");
  };
  try {
    // Landscape phones are supported full screen (owner, 2026-10-16).
    for (const page of pages) await page.setViewportSize({ width: 667, height: 375 });
    await holdClocks(a, ["stage", "song"]);
    await readyOnly(pages);
    await expect(a.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: SCREEN_SETTLE_MS });
    await looksEnabled(a, "stage");
    await lockStage(pages);
    await expect(a.getByTestId("select-screen")).toHaveAttribute("data-step", "song", { timeout: SCREEN_SETTLE_MS });
    await looksEnabled(a, "song");
    await holdClocks(a, []);
  } finally {
    for (const page of pages) await page.context().close();
  }
});

test("the song slide fits a small phone held upright, a tablet held sideways and a short window", async ({ browser }) => {
  test.slow();
  const box = (page: Page, testId: string) => page.getByTestId(testId).boundingBox().then((found) => found!);
  for (const [name, context] of [
    ["iPhone SE", devices["iPhone SE"]],
    ["iPad sideways", devices["iPad (gen 7) landscape"]],
    ["a 1000 x 700 window", { viewport: { width: 1000, height: 700 } }],
  ] as const) {
    const { defaultBrowserType: _, ...shape } = context as typeof context & { defaultBrowserType?: string };
    const [a] = (await openClients(browser, 1, undefined, { context: shape })) as [Page];
    try {
      await createRoom(a, "Alpha");
      await holdClocks(a, ["stage", "song"]);
      await readyOnly([a]);
      await expect(a.getByTestId("lock-in")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      // The scene is never a strip beside the panel: beside it, it has at least the panel's width, and Lock in stays inside the panel.
      const scene = await box(a, "picker");
      const panel = await a.locator(".ff-frame__panel").boundingBox();
      if (panel!.x > scene.x + scene.width) expect(scene.width, `${name}: the scene beside the panel`).toBeGreaterThanOrEqual(panel!.width);
      const lock = await box(a, "lock-in");
      expect(lock.x + lock.width <= panel!.x + panel!.width + 0.5 && lock.y + lock.height <= panel!.y + panel!.height + 0.5, `${name}: Lock in inside the panel`).toBe(true);
      await lockStage([a]);
      await turnPickerTo(a, "unseen");
      // A locked song's hint is drawn whole, inside the slide, and never behind its cover.
      const [cover, hint, slide] = [await box(a, "song-slide-cover"), await box(a, "song-slide-hint"), await box(a, "song-slide")];
      const apart = hint.x >= cover.x + cover.width || hint.y >= cover.y + cover.height;
      expect(apart, `${name}: the hint clear of the cover`).toBe(true);
      expect(hint.y >= slide.y && hint.y + hint.height <= slide.y + slide.height, `${name}: the hint inside the slide`).toBe(true);
    } finally {
      await a.context().close();
    }
  }
});

test("the select panel holds still on a short desk: Lock in never moves once the step is shown", async ({ browser }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1000, height: 700 }]) {
    const [a] = (await openClients(browser, 1, undefined, { context: { viewport } })) as [Page];
    try {
      await createRoom(a, "Alpha");
      await holdClocks(a, ["stage"]);
      await readyOnly([a]);
      await expect(a.getByTestId("lock-in")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await a.waitForTimeout(500);
      // Every frame for 2 s: one place for Lock in, or the lead is flipping between layouts.
      const places = await a.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const seen = new Set<string>();
            const end = performance.now() + 2_000;
            const sample = () => {
              const box = document.querySelector("[data-testid=lock-in]")!.getBoundingClientRect();
              seen.add(`${Math.round(box.x)},${Math.round(box.y)}`);
              if (performance.now() < end) requestAnimationFrame(sample);
              else resolve([...seen]);
            };
            requestAnimationFrame(sample);
          }),
      );
      expect(places, `${viewport.width}x${viewport.height}: Lock in's places on the stage step`).toHaveLength(1);
    } finally {
      await a.context().close();
    }
  }
});
