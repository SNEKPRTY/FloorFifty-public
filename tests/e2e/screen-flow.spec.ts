import { expect, test } from "./support/test";
import { driveRoom, waitForServer } from "./support/server-fixture";
import {
  CLIENT_BOOT_MS,
  CLIENT_FOLLOWS_MS,
  allowForBoot,
  createRoom,
  expectScreen,
  joinRoom,
  openClients,
  openTitle,
  passPhotosensitivity,
  passSplash,
  readyAll,
} from "./support/room-driver";

test.beforeAll(async () => {
  await waitForServer();
});

test("a first visit asks the language first, and the warning after it reads in the one picked", async ({ page }) => {
  // The first visit's dialog is the first thing the client draws, so this wait
  // is the client's boot (the stage, then the server's content), which the
  // helpers bound at CLIENT_BOOT_MS and add to the test's time.
  allowForBoot();
  await page.goto("/");
  const language = page.getByTestId("language-first");
  await expect(language).toBeVisible({ timeout: CLIENT_BOOT_MS });
  // Nothing of the warning or the splash behind it.
  await expect(page.getByTestId("photosensitivity-warning")).toHaveCount(0);
  await expect(page.getByTestId("splash")).toHaveCount(0);
  await expect(language.getByTestId("first-language-auto")).toBeChecked();
  await language.getByTestId("first-language-ja").check();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await language.getByTestId("language-first-continue").click();
  const warning = page.getByTestId("photosensitivity-warning");
  await expect(warning).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  await expect(warning.getByTestId("photosensitivity-continue")).not.toHaveText("Continue");
  await warning.getByTestId("photosensitivity-continue").click();
  await passSplash(page);
  await expectScreen(page, "title");

  // Chosen, so the next visit does not ask again.
  allowForBoot();
  await page.reload();
  await expect(page.getByTestId("splash")).toBeVisible({ timeout: CLIENT_BOOT_MS });
  await expect(language).toHaveCount(0);
});

test("a first visit warns of flashing before the splash, and the effects turned off there stay off", async ({ page }) => {
  allowForBoot();
  await page.goto("/");
  await page.getByTestId("language-first-continue").click({ timeout: CLIENT_BOOT_MS });
  const warning = page.getByTestId("photosensitivity-warning");
  await expect(warning).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  // Nothing of the splash starts behind it.
  await expect(page.getByTestId("splash")).toHaveCount(0);
  await expect(warning.getByTestId("photosensitivity-character-effects")).toBeChecked();
  await expect(warning.getByTestId("photosensitivity-stage-effects")).toBeChecked();
  await warning.getByTestId("photosensitivity-character-effects").uncheck();
  await warning.getByTestId("photosensitivity-stage-effects").uncheck();
  await warning.getByTestId("photosensitivity-continue").click();
  await expect(warning).toHaveCount(0);
  await passSplash(page);
  await expectScreen(page, "title");

  // The settings hold what was chosen there.
  await page.getByTestId("title-settings").click();
  await expect(page.getByTestId("settings-character-effects")).not.toBeChecked();
  await expect(page.getByTestId("settings-stage-effects")).not.toBeChecked();

  // Read once: the next visit goes straight to the splash.
  allowForBoot();
  await page.reload();
  await expect(page.getByTestId("splash")).toBeVisible({ timeout: CLIENT_BOOT_MS });
  await expect(warning).toHaveCount(0);
});

test("the splash art holds still with the stage effects turned off in the warning, and moves with them on", async ({ browser }) => {
  test.slow();
  /** Distinct frames of the canvas over two beats of the splash, which flips its duotone a beat. */
  const framesOver = async (stageEffects: boolean): Promise<number> => {
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    try {
      const page = await context.newPage();
      allowForBoot();
      await page.goto("/");
      await page.getByTestId("language-first-continue").click({ timeout: CLIENT_BOOT_MS });
      const warning = page.getByTestId("photosensitivity-warning");
      await expect(warning).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      if (!stageEffects) await warning.getByTestId("photosensitivity-stage-effects").uncheck();
      await warning.getByTestId("photosensitivity-continue").click();
      await expect(page.getByTestId("splash")).toHaveClass(/ff-splash--shown/, { timeout: CLIENT_FOLLOWS_MS });
      // The splash goes on loading behind itself (the menu and shell bundles and the
      // menu song), and its progress bar is DOM drawn over the canvas, so a screenshot
      // of the canvas includes it. Sampling while the bar still moves would count the
      // bar, not the art (seen: a 280 x 4 px strip, nothing else, differed between two
      // frames). Wait for the loading to end; the art alone is what is compared.
      await expect(page.getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS });
      // Past the cover's fade, which is not the art's motion.
      await page.waitForTimeout(500);
      const canvas = page.locator("#app canvas");
      const frames = new Set<string>();
      for (let shot = 0; shot < 8; shot += 1) {
        frames.add((await canvas.screenshot()).toString("base64"));
        await page.waitForTimeout(150);
      }
      return frames.size;
    } finally {
      await context.close();
    }
  };
  expect(await framesOver(true), "with the stage effects on, the art moves").toBeGreaterThan(1);
  expect(await framesOver(false), "with the stage effects off, the art is still").toBe(1);
});

test("splash waits for a tap, hands over to the title, and Play reaches the lobby", async ({ page }) => {
  await page.goto("/");
  await passPhotosensitivity(page);
  await expect(page.getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS });
  await page.waitForTimeout(1_500);
  await expectScreen(page, "splash");
  await expect(page.getByTestId("splash").getByRole("img", { name: "SNEKPRTY" })).toHaveCount(0);
  await passSplash(page);
  await expectScreen(page, "title");
  await expect(page.getByTestId("title-version")).toHaveText(/^v\d+\.\d+\.\d+(-rc\.\d+)?$/);
  await page.getByTestId("title-play").click();
  await expectScreen(page, "lobby");
  await expect(page.getByTestId("find-race")).toBeVisible();
  await expect(page.getByTestId("create-room")).toBeVisible();
});

test.describe("with motion on", () => {
  // The suite runs with reduced motion, under which nothing rises in at all.
  test.use({ reducedMotion: "no-preference" });

  test("Play keeps the hero where it stands, and only the panel changes", async ({ page }) => {
    await openTitle(page);
    await page.getByTestId("title-play").click();
    // Read in the frame the lobby mounts: a replayed rise-in would have the
    // hero at zero opacity then.
    const opacity = await page.waitForFunction(() => {
      if (document.querySelector('[data-testid="lobby"]') === null) return undefined;
      const hero = document.querySelector('[data-testid="menu-wordmark"]')?.parentElement;
      return hero === null || hero === undefined ? undefined : getComputedStyle(hero).opacity;
    });
    expect(await opacity.jsonValue()).toBe("1");
  });
});

test("return to menu releases the room", async ({ browser }) => {
  test.slow();
  const [host, guest] = await openClients(browser, 2);
  const code = await createRoom(host!, "Kite");
  await joinRoom(guest!, code, "Ninja 2");
  await readyAll([host!, guest!]);

  await expectScreen(host!, "gameplay");
  await driveRoom(code);
  await expectScreen(host!, "game-end");

  await host!.getByTestId("return-to-menu").click();
  await expectScreen(host!, "title");
  await expect(host!.getByTestId("title-play")).toBeVisible();

  await host!.context().close();
  await guest!.context().close();
});

test("a reconnect inside the grace window keeps the race on screen", async ({ browser }) => {
  test.slow();
  const [host, guest] = await openClients(browser, 2);
  const code = await createRoom(host!, "Kite");
  await joinRoom(guest!, code, "Ninja 2");
  await readyAll([host!, guest!]);
  await expectScreen(guest!, "gameplay");

  // Block the network before dropping the transport: otherwise the SDK can
  // start a new handshake while online, which setOffline then interrupts.
  await guest!.context().setOffline(true);
  await guest!.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(guest!.getByTestId("connection-state")).toBeVisible({ timeout: 15_000 });
  // The canvas is retained: a transport problem changes what is said, never
  // what is drawn.
  await expect(guest!.locator("#app canvas")).toBeVisible();

  await guest!.context().setOffline(false);
  await expect(guest!.getByTestId("connection-state")).toBeHidden({ timeout: 25_000 });
  await expectScreen(guest!, "gameplay");

  await host!.context().close();
  await guest!.context().close();
});

test("the race finishes for the players who remain when one leaves", async ({ browser }) => {
  test.slow();
  const [host, guest] = await openClients(browser, 2);
  const code = await createRoom(host!, "Kite");
  await joinRoom(guest!, code, "Ninja 2");
  await readyAll([host!, guest!]);
  await expectScreen(host!, "gameplay");

  await guest!.context().close();

  const result = await driveRoom(code);
  expect(result.phase).toBe("finished");
  await expectScreen(host!, "game-end");

  await host!.context().close();
});


test("leaving during reconnect keeps the replacement room after network returns", async ({ browser }) => {
  test.slow();
  const [host, guest] = await openClients(browser, 2);
  try {
    const code = await createRoom(host!, "Kite");
    await joinRoom(guest!, code, "Ninja 2");
    await readyAll([host!, guest!]);
    await expectScreen(guest!, "gameplay");
    await guest!.context().setOffline(true);
    await guest!.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(guest!.getByTestId("connection-state")).toBeVisible({ timeout: 15_000 });
    await guest!.getByTestId("pause-open").click();
    await guest!.getByTestId("pause-leave").click();
    await guest!.getByTestId("pause-leave-confirm").click();
    await expectScreen(guest!, "title");
    await guest!.context().setOffline(false);
    await guest!.getByTestId("title-play").click();
    await expectScreen(guest!, "lobby");
    const replacement = await createRoom(guest!, "New session");
    expect(replacement).not.toBe(code);
    await expect(guest!.getByTestId("room-code")).toHaveText(replacement);
    await guest!.waitForTimeout(2_500); // Beyond the longest obsolete backoff.
    await expect(guest!.getByTestId("room-code")).toHaveText(replacement);
    await expect(guest!.getByTestId("connection-state")).toBeHidden();
  } finally {
    await host!.context().close();
    await guest!.context().close();
  }
});
