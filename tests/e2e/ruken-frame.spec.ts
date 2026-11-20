import { expect, test, type FrameLocator, type Page } from "./support/test";
import { SETTINGS_KEY } from "../../apps/client/src/features/profile/settings";
import { RESULTS_TIMEOUT_MS, SELECT_TIMEOUT_MS } from "./support/room-driver";
import { startFrameHost, type FrameHost } from "./support/frame-host";
import { driveRoom, waitForServer } from "./support/server-fixture";

/**
 * Floor Fifty framed the way the new Ruken frames it.
 *
 * The new Ruken has no SDK. It serves a game as a plain folder on its own
 * origin and frames it from another, in a sandboxed iframe
 * (`support/frame-host.ts`). The game speaks no host protocol: it boots at
 * once on the browser's own storage, and nothing waits for a host. These specs
 * pin what that frame must still allow: the game boots, plays from the title
 * through a tutorial and a race, and keeps its settings, in the frame.
 * (Before 2026-11-13 this spec ran the game inside the SDK's fake host; that
 * handshake, and what it carried, are gone.)
 *
 * Kept on failure, a video of the run is in the report.
 */
test.use({ video: "retain-on-failure" });

/**
 * How long a screen may take to appear. The standalone specs wait 20 s on a
 * GPU; this is wider because the frame is one more thing the page paints.
 */
const SCREEN_TIMEOUT_MS = 60_000;

test.beforeAll(async () => {
  await waitForServer();
});

let host: FrameHost | undefined;

test.afterEach(async () => {
  await host?.close();
  host = undefined;
});

/** Opens the host page and gives back the locator for the game's frame inside it. */
async function openHost(page: Page, hostToOpen: FrameHost): Promise<FrameLocator> {
  await page.goto(hostToOpen.url);
  return page.frameLocator("iframe");
}

/** A screen is reached when its root is there and the transition veil has revealed it. */
async function expectScreen(game: FrameLocator, screen: string, timeout = SCREEN_TIMEOUT_MS): Promise<void> {
  await expect(game.locator(`[data-screen="${screen}"]`)).toBeVisible({ timeout });
  await expect(game.getByTestId("transition-veil")).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Goes through a first visit's language step, photosensitivity warning and
 * splash tap to the title, inside the host's frame. The same steps the
 * standalone specs take (`support/room-driver.ts`), on a frame locator.
 */
async function passToTitle(game: FrameLocator): Promise<void> {
  const language = game.getByTestId("language-first");
  const warning = game.getByTestId("photosensitivity-warning");
  const splash = game.getByTestId("splash");
  await expect(language.or(warning).or(splash)).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  if (await language.isVisible()) {
    await language.getByTestId("language-first-continue").click();
    await expect(language).toHaveCount(0);
    await expect(warning).toBeVisible({ timeout: 20_000 });
  }
  if (await warning.isVisible()) {
    await warning.getByTestId("photosensitivity-continue").click();
    await expect(warning).toHaveCount(0);
  }
  await tapSplash(game);
}

/** Taps through the splash, once it asks for the tap, to the title. */
async function tapSplash(game: FrameLocator): Promise<void> {
  const splash = game.getByTestId("splash");
  await expect(splash.getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: SCREEN_TIMEOUT_MS });
  await splash.click();
  await expectScreen(game, "title");
}

/** Locks in each pick step (stage, then song) until the select screen has gone. */
async function passSelect(page: Page, game: FrameLocator): Promise<void> {
  const select = game.getByTestId("select-screen");
  await expect(select, "the select screen opens after Ready").toBeVisible({ timeout: 15_000 });
  const deadline = Date.now() + SELECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await select.count()) === 0) return;
    const lock = game.getByTestId("lock-in");
    // Bounded: the button can go between the count and the click as a step ends.
    if ((await lock.count()) > 0 && (await lock.isEnabled({ timeout: 1_000 }).catch(() => false))) {
      await lock.click({ timeout: 2_000 }).catch(() => undefined);
    } else {
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`the room did not leave the select screen within ${SELECT_TIMEOUT_MS / 1000} s`);
}

/** From the title through Play into a room of one, ready, select and onto the stage. Returns the room code. */
async function startRace(page: Page, game: FrameLocator): Promise<string> {
  await game.getByTestId("title-play").click();
  await expectScreen(game, "lobby");
  // A first Play is offered the tutorial; this is about the race, so decline it.
  const offer = game.getByTestId("tutorial-offer-skip");
  if (await offer.waitFor({ state: "visible", timeout: 1_000 }).then(() => true, () => false)) await offer.click();

  await game.getByTestId("name-input").fill("Harness");
  await game.getByTestId("create-room").click();
  await expect(game.getByTestId("room-code")).not.toBeEmpty({ timeout: 15_000 });
  const code = (await game.getByTestId("room-code").textContent()) ?? "";
  // Rooms open on Survival (catalog order, 2026-10-13); this races the 20 floors, with a time to post.
  await game.getByTestId("mode-floors-20").click();
  await expect(game.getByTestId("mode-floors-20")).toHaveAttribute("aria-checked", "true");
  await game.getByTestId("ready-toggle").click();
  await passSelect(page, game);
  await expectScreen(game, "gameplay");
  return code;
}

test("the game boots in the sandboxed frame without a host, and plays from the title through the tutorial", async ({ page, baseURL }) => {
  test.slow();
  host = await startFrameHost({ gameUrl: baseURL ?? "" });
  const game = await openHost(page, host);

  await test.step("the frame is sandboxed, and the game reaches its title with no host to wait for", async () => {
    await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
    await passToTitle(game);
    await expect(game.getByTestId("title-play")).toBeVisible();
    // The game speaks no host protocol: it posts nothing to its parent.
    expect(await host?.messagesFromGame(page)).toEqual([]);
  });

  await test.step("the title's Settings open and close", async () => {
    await game.getByTestId("title-settings").click();
    await expect(game.getByTestId("settings-modal")).toBeVisible();
    await game.getByTestId("modal-close").click();
    await expect(game.getByTestId("settings-modal")).toHaveCount(0);
  });

  await test.step("Socials show each address with Copy, since the frame blocks the new tab a link would open", async () => {
    await game.getByTestId("quick-contact").click();
    const copyList = game.getByTestId("contact-copy");
    await expect(copyList).toBeVisible();
    await expect(copyList.locator("a")).toHaveCount(0);
    await expect(game.getByTestId("social-discord-address")).toHaveText("discord.gg/snekprty");
    await expect(game.getByTestId("social-discord-copy")).toBeVisible();
    await game.getByTestId("modal-close").click();
    await expect(copyList).toHaveCount(0);
  });

  await test.step("the tutorial starts and its pause overlay opens and closes", async () => {
    await game.getByTestId("quick-tutorial").click();
    await expectScreen(game, "tutorial");
    await expect(game.getByTestId("tutorial-prompt")).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
    await game.getByTestId("pause-open").click();
    await expect(game.getByTestId("pause-overlay")).toBeVisible();
    await game.getByTestId("pause-resume").click();
    await expect(game.getByTestId("pause-overlay")).toHaveCount(0);
  });

  await test.step("leaving the tutorial returns to the title", async () => {
    await game.getByTestId("pause-open").click();
    await game.getByTestId("pause-leave").click();
    await expectScreen(game, "title");
  });
});

test("a race in the frame runs to the results and back to the title", async ({ page, baseURL }) => {
  test.slow();
  host = await startFrameHost({ gameUrl: baseURL ?? "" });
  const game = await openHost(page, host);

  await passToTitle(game);
  const code = await startRace(page, game);

  const outcome = await driveRoom(code, { ticks: 60 * 240 });
  expect(outcome.phase, "the driver finishes the race").toBe("finished");
  await expectScreen(game, "game-end", RESULTS_TIMEOUT_MS);
  await game.getByTestId("return-to-menu").click();
  await expectScreen(game, "title");
  expect(await host?.messagesFromGame(page)).toEqual([]);
});

test("settings are kept in the frame's own storage, and survive a reload", async ({ page, baseURL }) => {
  test.slow();
  host = await startFrameHost({ gameUrl: baseURL ?? "" });
  const game = await openHost(page, host);

  await test.step("the first visit's steps are taken, Stage effects go off and Mute is turned on", async () => {
    await passToTitle(game);
    await game.getByTestId("title-settings").click();
    await expect(game.getByTestId("settings-modal")).toBeVisible();
    await game.getByTestId("settings-stage-effects").uncheck();
    await expect(game.getByTestId("settings-stage-effects")).not.toBeChecked();
    await game.getByTestId("settings-mute").click();
    await expect(game.getByTestId("settings-mute")).toBeChecked();
  });

  await test.step("all of it is in the frame's localStorage, under the one settings key", async () => {
    await expect
      .poll(
        async () => {
          const raw = await game.locator("body").evaluate((_body, key) => window.localStorage.getItem(key), SETTINGS_KEY);
          return JSON.parse(raw ?? "{}") as { display?: { stageEffects?: boolean }; audio?: { muted?: boolean }; seen?: { photosensitivity?: boolean } };
        },
        { timeout: 20_000 },
      )
      .toMatchObject({ display: { stageEffects: false }, audio: { muted: true }, seen: { photosensitivity: true } });
  });

  await test.step("after a reload the game starts as it was left: no first-visit steps, settings kept", async () => {
    await page.reload();
    const reloaded = page.frameLocator("iframe");
    await expect(reloaded.getByTestId("splash")).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
    await expect(reloaded.getByTestId("language-first")).toHaveCount(0);
    await expect(reloaded.getByTestId("photosensitivity-warning")).toHaveCount(0);
    await tapSplash(reloaded);
    await reloaded.getByTestId("title-settings").click();
    await expect(reloaded.getByTestId("settings-stage-effects")).not.toBeChecked();
    await expect(reloaded.getByTestId("settings-mute")).toBeChecked();
  });
});
