/**
 * The smoke set: the journeys every player takes, on the real client against
 * the real server, once on a phone and once on a desktop (the `mobile-portrait`
 * and `desktop` projects). It is the browser gate (Owner, 2026-11-18: "smoke
 * set plus cheap CI"), so it holds to three rules: every wait is on the page's
 * own state, never a sleep; nothing is retried; and each journey stands alone,
 * in its own fresh device, so one failure names one journey.
 *
 * The race is finished by the server's test driver, which feeds valid inputs
 * into the same simulation a keypress reaches: the journey is the player's,
 * the minutes of climbing are not.
 */

import type { BrowserContextOptions, BrowserType, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./support/test";
import { driveRoom, holdRoomClocks, waitForServer } from "./support/server-fixture";
import { FRAME_CONTROL, GPU_LIKE } from "./support/frame-control";
import { enterStory } from "./support/story";
import { keyHands, playChapterOne, stepFrames } from "./support/story-play";
import {
  seedSettings,
  CLIENT_BOOT_MS,
  CLIENT_FOLLOWS_MS,
  RESULTS_TIMEOUT_MS,
  SCREEN_SETTLE_MS,
  allowForBoot,
  createRoom,
  enterLobby,
  openTitle,
  expectScreen,
  joinRoom,
  openClient,
  passSelect,
  passSplash,
} from "./support/room-driver";

const follows = expect.configure({ timeout: CLIENT_FOLLOWS_MS });

test.beforeAll(async () => {
  await waitForServer();
});

/**
 * A second device of the same kind as the project's, in its own browser.
 *
 * Its own browser, not a second context in the host's: a friend's phone is
 * another machine. It matters in software WebGL too, where one browser's GPU
 * process draws every page it has on one thread: two desktop pages there took
 * about 7 s for each click, and the journey 3 minutes of its 4.
 * `BrowserType.launch` starts from Playwright's defaults, so the project's
 * device and launch options are copied across.
 */
async function sameDevice(testInfo: TestInfo, browserType: BrowserType): Promise<{ guest: Page; close: () => Promise<void> }> {
  const use = testInfo.project.use;
  const browser = await browserType.launch({ ...use.launchOptions, ...(use.channel === undefined ? {} : { channel: use.channel }), headless: true });
  const options: BrowserContextOptions = {
    viewport: use.viewport ?? null,
    isMobile: use.isMobile ?? false,
    hasTouch: use.hasTouch ?? false,
    reducedMotion: "reduce",
    ...(use.userAgent === undefined ? {} : { userAgent: use.userAgent }),
    ...(use.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: use.deviceScaleFactor }),
  };
  const context = await browser.newContext(options);
  // A friend who has been shown how, as every client the specs open is: this journey is not about the match gate.
  await seedSettings(context, { seen: { tutorial: true } });
  const guest = await context.newPage();
  return { guest, close: () => browser.close() };
}

/** The seats that say "CPU" where a player's status would be. */
const cpuLabels = (page: Page) => page.getByTestId("seat-status").filter({ hasText: /^CPU$/ });

/**
 * In the race: the host's room, readied with a CPU, through the select screen.
 * With `holdCountdown`, the room's countdown is held (server `clock-hold.ts`),
 * so the race screen stays up for as long as the journey needs it: a CPU left
 * to race wins a 20-floor climb in well under a minute, and the results then
 * take the screen from under the pause menu.
 */
async function raceCpus(page: Page, options: { holdCountdown?: boolean } = {}): Promise<string> {
  await openClient(page);
  const code = await createRoom(page, "Kite");
  if (options.holdCountdown === true) await holdRoomClocks(code, ["countdown"]);
  await page.getByTestId("seat-add-cpu").first().click();
  await follows(cpuLabels(page)).toHaveCount(1);
  await page.getByTestId("ready-toggle").click();
  await passSelect([page]);
  await expectScreen(page, "gameplay");
  return code;
}

test("a first visit: the language step, the warning, the splash, the title", async ({ page }) => {
  allowForBoot();
  await page.goto("/");
  const language = page.getByTestId("language-first");
  await expect(language).toBeVisible({ timeout: CLIENT_BOOT_MS });
  await language.getByTestId("language-first-continue").click();
  await expect(language).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
  await expect(page.getByTestId("photosensitivity-warning")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  await passSplash(page);
  await expectScreen(page, "title");
  await expect(page.getByTestId("title-play")).toBeVisible();

  // A returning player goes straight to the splash: the steps are remembered.
  await page.reload();
  await expect(page.getByTestId("splash")).toBeVisible({ timeout: CLIENT_BOOT_MS });
  await expect(language).toBeHidden();
});

test("a friend joins by code, and the host fills a seat with a CPU", async ({ page }, testInfo) => {
  const { guest, close } = await sameDevice(testInfo, page.context().browser()!.browserType());
  try {
    await openClient(page);
    await openClient(guest);
    const code = await createRoom(page, "Kite");
    await joinRoom(guest, code, "Wren");
    // What each seat says, as the players read it.
    for (const each of [page, guest]) {
      await follows(each.getByTestId("seat-name")).toContainText(["Kite", "Wren"]);
      await follows(cpuLabels(each)).toHaveCount(0);
    }
    await page.getByTestId("seat-add-cpu").first().click();
    for (const each of [page, guest]) {
      await follows(cpuLabels(each)).toHaveCount(1);
    }
  } finally {
    await close();
  }
});

test("a race against CPUs to the finish, the results, and racing again", async ({ page }) => {
  test.slow();
  const code = await raceCpus(page);
  const outcome = await driveRoom(code, { ticks: 60 * 240 });
  expect(outcome.phase, "the driver finishes the race").toBe("finished");
  await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
  await follows(page.getByTestId("result-row")).toHaveCount(outcome.progress.length);
  await page.getByTestId("race-again").click();
  await expectScreen(page, "lobby");
  await follows(page.getByTestId("ready-toggle")).toBeVisible();
});

test("pause during the countdown, resume, then leave for the title", async ({ page }) => {
  test.slow();
  await raceCpus(page, { holdCountdown: true });
  const overlay = page.getByTestId("pause-overlay");
  await page.getByTestId("pause-open").click();
  await follows(overlay).toBeVisible();
  await page.getByTestId("pause-resume").click();
  await follows(overlay).toHaveCount(0);
  await page.getByTestId("pause-open").click();
  await follows(overlay).toBeVisible();
  await page.getByTestId("pause-leave").click();
  await page.getByTestId("pause-leave-confirm").click();
  await expectScreen(page, "title", SCREEN_SETTLE_MS);
  // And from the title, back into a lobby as a returning player would.
  await enterLobby(page);
});

test("the story: the hub, the first cutscene skipped, chapter 1 finished on the keys, and its results", async ({ page, isMobile }) => {
  // A phone drawn whole (GPU_LIKE) at its own pixel density boots past the splash's wait in software WebGL;
  // the GPU gate plays it on the phone too.
  test.skip(isMobile && process.env["FLOOR_FIFTY_NO_GPU"] === "1", "a phone's stepped frames need a GPU");
  // About 450 ticks stepped one at a time: seconds on a GPU, several minutes in software WebGL.
  test.setTimeout(720_000);
  // A smaller window draws each stepped frame faster where WebGL is software (a phone's is already small).
  if (!isMobile) await page.setViewportSize({ width: 800, height: 450 });
  await page.addInitScript(GPU_LIKE);
  await page.addInitScript(FRAME_CONTROL);
  await openTitle(page);
  await enterStory(page);
  const ticks = await playChapterOne(page, keyHands(page));
  expect(ticks, "the chapter's goal was reached inside the limit").toBeLessThan(2_400);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("floor-fifty.settings.v1") ?? "{}").story?.chaptersDone ?? 0)).toBeGreaterThanOrEqual(1);
  // The results stand over the frozen climb; their stars pop in on the frames stepped.
  await stepFrames(page, 90);
  await expect(page.getByTestId("story-results")).toBeVisible();
  await expect(page.getByTestId("story-results-star").first()).toHaveAttribute("data-earned", "true");
  await expect(page.getByTestId("story-next")).toBeVisible();
});

test("Leave story in the pause goes to the hub, and the hub's Back to the title", async ({ page }) => {
  await openTitle(page);
  await enterStory(page);
  await page.keyboard.press("Escape");
  await follows(page.getByTestId("pause-restart")).toBeVisible();
  await page.getByTestId("pause-leave").click();
  await follows(page.getByTestId("story-hub")).toBeVisible();
  await page.getByTestId("story-hub-back").click();
  await expectScreen(page, "title", SCREEN_SETTLE_MS);
});

test("a first visit's Create room asks to be shown how, and Skip goes on into the room", async ({ page }) => {
  await seedSettings(page.context(), { seen: { tutorial: false } });
  await openTitle(page);
  await enterLobby(page);
  await page.getByTestId("name-input").fill("Granny");
  await page.getByTestId("create-room").click();
  await follows(page.getByTestId("match-gate")).toBeVisible();
  await page.getByTestId("match-gate-skip").click();
  await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: SCREEN_SETTLE_MS });
});
