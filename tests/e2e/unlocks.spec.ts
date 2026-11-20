/**
 * Unlocks earned in play (unlockables spec §5, §7), a replay saved and shared
 * as video (§6, amended 2026-10-03), and the DLC teaser sheet (§8), against
 * the production preview build: no `?dev=` flag, so every grant is earned.
 *
 * The race tests run on `desktop` alone; the sheet and the sizes run on all
 * four form factors (`unlocks` is in `VIEWPORT_SENSITIVE`).
 */

import { statSync } from "node:fs";
import { expect, test, devices, type Browser, type BrowserContext, type Page, type TestInfo } from "./support/test";
import { readCounters } from "./support/inspection";
import {
  createRoom,
  expectScreen,
  lockStage,
  openClient,
  openTitle,
  readyAll,
  readyOnly,
  RESULTS_TIMEOUT_MS,
  seedProgress,
  turnPickerTo,
} from "./support/room-driver";
import { driveRoom, waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

const desktopOnly = (info: TestInfo): void => test.skip(info.project.name !== "desktop", "a race test; the form factors are tests 5 and 6");

type Client = { context: BrowserContext; page: Page };

/**
 * Counts the capture tracks the page opens (the recording canvas's, with the
 * master tap's audio added to it), so a test can ask how many are still live.
 */
async function watchCaptures(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const streams: MediaStream[] = [];
    const canvasCapture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (this: HTMLCanvasElement, ...args: [number?]) {
      const stream = canvasCapture.apply(this, args);
      streams.push(stream);
      return stream;
    };
    const tap = AudioContext.prototype.createMediaStreamDestination;
    AudioContext.prototype.createMediaStreamDestination = function (this: AudioContext) {
      const node = tap.call(this);
      streams.push(node.stream);
      return node;
    };
    (window as unknown as { __ffLiveCaptures: () => number }).__ffLiveCaptures = () =>
      new Set(streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live")).size;
  });
}

const liveCaptures = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __ffLiveCaptures: () => number }).__ffLiveCaptures());

/** One client in its own context, seeded before any script runs, through Play into the lobby. */
async function openSeeded(
  browser: Browser,
  options: {
    device?: string;
    progress?: Parameters<typeof seedProgress>[1];
    prepare?: (context: BrowserContext) => Promise<unknown>;
  } = {},
): Promise<Client> {
  let use = {};
  if (options.device !== undefined) {
    const { defaultBrowserType: _browser, ...device } = devices[options.device]!;
    use = device;
  }
  const context = await browser.newContext(use);
  if (options.progress !== undefined) await seedProgress(context, options.progress);
  await options.prepare?.(context);
  const page = await context.newPage();
  await openClient(page);
  return { context, page };
}

/** From the ready room, everyone readies, races (driven by the test driver) and reaches results. */
async function race(pages: Page[], code: string): Promise<void> {
  await readyAll(pages);
  for (const page of pages) await expectScreen(page, "gameplay");
  const outcome = await driveRoom(code, { ticks: 60 * 240 });
  expect(outcome.phase, "the driver finishes the race").toBe("finished");
  for (const page of pages) await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
}

/** Race again from results, back into the ready room. */
async function raceAgain(pages: Page[]): Promise<void> {
  for (const page of pages) await page.getByTestId("race-again").click();
  for (const page of pages) await expectScreen(page, "lobby");
}

/** The grant this page's results announce: the banner's kind and the live region's words. */
async function expectGrant(page: Page, kind: "song" | "character", line: string): Promise<void> {
  await expect(page.getByTestId("unlock-announcer")).toHaveText(line, { timeout: 10_000 });
  await expect(page.getByTestId("unlock-banner")).toHaveAttribute("data-kind", kind);
}

/** From the title, the Character page, paged to Penguin (After Hours, the DLC pack), then its Coming soon. */
async function openDlcTeaser(page: Page): Promise<void> {
  await openTitle(page);
  await page.getByTestId("title-character").click();
  const penguin = page.getByTestId("character-page").locator('[data-testid=tile][data-id="penguin"]');
  // The pages beside the shown one are laid out off to the side and inert: page until Penguin's is shown.
  for (let turn = 0; turn < 4; turn += 1) {
    if (await penguin.click({ timeout: 1_000, trial: true }).then(() => true, () => false)) break;
    await page.getByTestId("page-next").click();
  }
  await expect(penguin).toBeInViewport();
  await penguin.click();
  await page.getByTestId("character-coming-soon").click();
}

async function watchReplay(page: Page): Promise<void> {
  await expect(page.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("watch-replay").click();
  await expectScreen(page, "replay");
  await expect(page.getByTestId("replay-save-video")).toBeEnabled({ timeout: 10_000 });
}

test.describe("unlocks earned in play", () => {
  test("a solo race grants Crash Mode with its banner, and the song step shows it new until passed", async ({ browser }, info) => {
    desktopOnly(info);
    test.setTimeout(180_000);
    const { context, page } = await openSeeded(browser);
    const code = await createRoom(page, "Alpha");
    await race([page], code);
    await expectGrant(page, "song", "New song unlocked: Crash Mode");

    await raceAgain([page]);
    await readyOnly([page]);
    await lockStage([page]);
    await turnPickerTo(page, "crash-mode");
    const slide = page.getByTestId("song-slide");
    await expect(slide).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("song-slide-new")).toBeVisible();
    // A picker slide is revealed when the player moves off it (Task 7's ruling).
    await page.getByTestId("picker-next").click();
    await page.getByTestId("picker-previous").click();
    await expect(page.getByTestId("picker")).toHaveAttribute("data-id", "crash-mode");
    await expect(page.getByTestId("song-slide-new")).toHaveCount(0);
    await context.close();
  });

  test("a fifth match grants Frog with its banner, and the ready room's Character page shows Frog new until looked at", async ({ browser }, info) => {
    desktopOnly(info);
    test.setTimeout(180_000);
    const { context, page } = await openSeeded(browser, {
      progress: { unlocked: ["any-match", "games-2", "share-replay", "games-3"], matchesFinished: 4 },
    });
    const code = await createRoom(page, "Alpha");
    await race([page], code);
    await expectGrant(page, "character", "New character unlocked: Frog");

    await raceAgain([page]);
    await page.getByTestId("seat-change").click();
    const frog = page.getByTestId("character-page").locator('[data-testid=tile][data-id="frog"]');
    await expect(frog.getByTestId("tile-new")).toBeVisible();
    await frog.click();
    await expect(frog.getByTestId("tile-new")).toHaveCount(0);
    await context.close();
  });

  test("alone on one device: the second match earns Pyramid Scheme, the third Static in the Air", async ({ browser }, info) => {
    desktopOnly(info);
    test.setTimeout(240_000);
    const { context, page } = await openSeeded(browser, { progress: { unlocked: ["any-match"], matchesFinished: 1 } });
    const code = await createRoom(page, "Solo");
    await race([page], code);
    await expectGrant(page, "song", "New song unlocked: Pyramid Scheme");
    await raceAgain([page]);
    await race([page], code);
    await expectGrant(page, "song", "New song unlocked: Static in the Air");
    await context.close();
  });

  test("Save video in the replay window downloads a non-empty .mp4", async ({ browser }, info) => {
    desktopOnly(info);
    test.setTimeout(180_000);
    const { context, page } = await openSeeded(browser, { progress: { unlocked: ["any-match"] } });
    const code = await createRoom(page, "Alpha");
    await race([page], code);
    await watchReplay(page);
    const download = page.waitForEvent("download");
    await page.getByTestId("replay-save-video").click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/\.mp4$/);
    const path = info.outputPath(saved.suggestedFilename());
    await saved.saveAs(path);
    expect(statSync(path).size).toBeGreaterThan(10 * 1024);
    await context.close();
  });

  test("Share video sends one video/mp4 file, and Unseen is granted in the next round", async ({ browser }, info) => {
    desktopOnly(info);
    test.setTimeout(240_000);
    const { context, page } = await openSeeded(browser, {
      prepare: (seeded) =>
        seeded.addInitScript(() => {
          const shared: { count: number; types: string[] }[] = [];
          (window as unknown as { __ffShared: typeof shared }).__ffShared = shared;
          Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: () => true });
          Object.defineProperty(Navigator.prototype, "share", {
            configurable: true,
            value: async (data: ShareData) => {
              shared.push({ count: data.files?.length ?? 0, types: (data.files ?? []).map((file) => file.type) });
            },
          });
        }),
    });
    const code = await createRoom(page, "Alpha");
    await race([page], code);
    // This round's slot went to Crash Mode, so the share waits for the next.
    await expectGrant(page, "song", "New song unlocked: Crash Mode");
    await watchReplay(page);
    await page.getByTestId("replay-share-video").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ffShared: unknown[] }).__ffShared)).toEqual([
      { count: 1, types: ["video/mp4"] },
    ]);
    await expect(page.getByTestId("replay-share-note")).toHaveText("Videos show everyone's names");
    await page.keyboard.press("Escape");
    await expectScreen(page, "game-end");

    await raceAgain([page]);
    await race([page], code);
    await expectGrant(page, "song", "New song unlocked: Unseen");
    await context.close();
  });
});

test.describe("the DLC teaser sheet", () => {
  test("opens from Penguin's tile on the Character page, and Escape closes it", async ({ page }) => {
    await openDlcTeaser(page);
    const sheet = page.getByTestId("coming-soon");
    await expect(sheet).toBeInViewport();
    await expect(sheet.getByTestId("coming-soon-line")).toHaveText("Coming soon");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("character-page")).toBeVisible();
  });
});

const SIZES = [
  [780, 270],
  [390, 844],
  [820, 1180],
  [1280, 720],
] as const;

test.describe("in view at every size", () => {
  test("the teaser sheet and its close", async ({ page }) => {
    await openDlcTeaser(page);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await expect(page.getByTestId("coming-soon"), `${width}×${height}`).toBeInViewport();
      await expect(page.getByTestId("coming-soon").getByTestId("modal-close"), `${width}×${height}`).toBeInViewport({ ratio: 1 });
    }
  });

  test("Save video and Share video in the replay window", async ({ browser }, info) => {
    desktopOnly(info);
    test.setTimeout(180_000);
    const { context, page } = await openSeeded(browser, { progress: { unlocked: ["any-match"] } });
    const code = await createRoom(page, "Alpha");
    await race([page], code);
    await watchReplay(page);
    await page.getByTestId("replay-play").click();
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      for (const id of ["replay-save-video", "replay-share-video"]) {
        await expect(page.getByTestId(id), `${id} at ${width}×${height}`).toBeInViewport({ ratio: 1 });
      }
    }
    await context.close();
  });
});

test("five banner cycles and five recorded races leak nothing", async ({ browser }, info) => {
  desktopOnly(info);
  test.setTimeout(600_000);
  // Grants waiting in the queue, oldest first, so every round shows a banner:
  // three songs, then Crash Mode (met in round one), then Frog at the fifth match.
  const { context, page } = await openSeeded(browser, {
    progress: { unlocked: [], pending: ["games-2", "games-3", "share-replay"] },
    prepare: watchCaptures,
  });
  const code = await createRoom(page, "Alpha");
  const cycle = async (line: string, kind: "song" | "character" = "song"): Promise<void> => {
    await race([page], code);
    await expectGrant(page, kind, line);
    await page.getByTestId("unlock-banner").dispatchEvent("pointerdown");
    await expect(page.getByTestId("unlock-banner")).toHaveCount(0);
    await expect.poll(() => liveCaptures(page), { message: "no capture track is live at results" }).toBe(0);
  };

  await cycle("New song unlocked: Pyramid Scheme");
  const baseline = await readCounters(page);
  for (const [line, kind] of [
    ["New song unlocked: Static in the Air", "song"],
    ["New song unlocked: Unseen", "song"],
    ["New song unlocked: Crash Mode", "song"],
    ["New character unlocked: Frog", "character"],
  ] as const) {
    await raceAgain([page]);
    await cycle(line, kind);
  }
  // One more race with nothing to grant: the recording alone.
  await raceAgain([page]);
  await race([page], code);
  await expect.poll(() => liveCaptures(page)).toBe(0);

  await expect
    .poll(async () => (await readCounters(page)).audioSources, { timeout: 10_000, message: "audio sources settle at or below baseline" })
    .toBeLessThanOrEqual(baseline.audioSources);
  const after = await readCounters(page);
  expect(after.displayObjects).toBe(baseline.displayObjects);
  expect(after.veilCanvases).toBe(baseline.veilCanvases);
  expect(after.glContexts).toBe(baseline.glContexts);
  expect(after.previewSources).toBeLessThanOrEqual(baseline.previewSources);
  await context.close();
});
