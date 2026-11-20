import { expect, test, type Page } from "./support/test";
import { COUNTDOWN_TICKS, LOADING_TIMEOUT_TICKS, REVEAL_TICKS } from "../../packages/shared/src/common/constants";
import {
  FakePad,
  expectFocusContained,
  expectFocusSettled,
  focusedTestId,
  readInput,
  type PadMode,
} from "./support/fake-gamepad";
import {
  CLIENT_BOOT_MS,
  CLIENT_FOLLOWS_MS,
  RESULTS_TIMEOUT_MS,
  SCREEN_SETTLE_MS,
  expectScreen,
  createRoom,
  openClients,
  openTitle,
  passPhotosensitivity,
  passSplash,
} from "./support/room-driver";
import { ROOM_CODE_ALPHABET } from "../../packages/shared/src/common/schemas";
import { driveRoom, holdRoomClocks, waitForRoom, waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

/** Loads the title with a pad connected, and marks the page so a reload shows. */
async function padOnTitle(page: Page): Promise<FakePad> {
  const pad = await FakePad.install(page);
  await openTitle(page);
  await page.evaluate(() => ((window as unknown as { __ffStillHere: boolean }).__ffStillHere = true));
  await pad.connect();
  return pad;
}

/** From the title into a solo race, pad only. Returns the room code. */
async function padIntoRace(page: Page, pad: FakePad, mode: PadMode): Promise<string> {
  await pad.walkTo("title-play", mode);
  await pad.tap("south");
  await expectScreen(page, "lobby");
  // Every screen change leaves focus on a control, drawn, never on the page.
  await expectFocusSettled(page);
  await pad.walkTo("create-room", mode);
  await pad.tap("south");
  await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: 15_000 });
  await expect(page.getByTestId("seat-name").first()).toHaveText(/^Racer \d\d$/);
  const code = (await page.getByTestId("room-code").textContent()) ?? "";
  await expectFocusSettled(page);
  // Pause suspends local input, not the authority's race. A finite race keeps
  // this idle racer alive while a slow browser inspects menus and held inputs.
  await pad.walkTo("mode-floors-50", mode);
  await pad.tap("south");
  await expect(page.getByTestId("mode-floors-50")).toHaveAttribute("aria-checked", "true", { timeout: CLIENT_FOLLOWS_MS });
  // Lock both choices with the pad. Holding their automatic expiry keeps a
  // slow WebKit run from missing a step; reveals and loading still advance.
  await holdRoomClocks(code, ["stage", "song"]);
  try {
    await pad.walkTo("ready-toggle", mode);
    await pad.tap("south");
    for (const step of ["stage", "song"] as const) {
      await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", step, { timeout: SCREEN_SETTLE_MS });
      await expectFocusSettled(page);
      await pad.walkTo("lock-in", mode);
      await pad.tap("south");
      if (step === "stage") {
        await waitForRoom(code, (now) => now.step === "song", {
          what: "the song step opens after the pad locks the stage",
          ticks: REVEAL_TICKS + 30,
        });
      }
    }
    await waitForRoom(code, (now) => now.phase === "racing", {
      what: "the race begins after the pad locks the song",
      ticks: REVEAL_TICKS + LOADING_TIMEOUT_TICKS + COUNTDOWN_TICKS + 30,
    });
  } finally {
    await holdRoomClocks(code, []);
  }
  await expectScreen(page, "gameplay", SCREEN_SETTLE_MS);
  await expect.poll(() => readInput(page)).not.toBeNull();
  return code;
}

for (const mode of ["dpad", "stick"] as const) {
  test.describe(`with the ${mode}`, () => {
    test("plays the whole game with only the pad", async ({ page }) => {
      test.slow();
      const pad = await padOnTitle(page);
      const code = await padIntoRace(page, pad, mode);

      // Steering, both ways.
      for (const side of ["left", "right"] as const) {
        await pad.hold(side, mode);
        await expect.poll(() => readInput(page)).toMatchObject({ [side]: true });
        await pad.letGo(side, mode);
        await expect.poll(() => readInput(page)).toMatchObject({ [side]: false });
      }

      // A fast-falls.
      await pad.press("south");
      await expect.poll(() => readInput(page)).toMatchObject({ fastFall: true });
      await pad.release("south");
      await expect.poll(() => readInput(page)).toMatchObject({ fastFall: false });

      // Start pauses; nothing is held underneath.
      await pad.tap("start");
      await expect(page.getByTestId("pause-overlay")).toBeVisible();
      expect(await readInput(page)).toEqual({ left: false, right: false, fastFall: false });

      // Settings: move a slider, then B back to the menu, on Settings.
      await pad.walkTo("pause-settings", mode);
      await pad.tap("south");
      await expectFocusContained(page);
      await pad.walkTo("settings-music", mode);
      const before = Number(await page.getByTestId("settings-music").inputValue());
      await pad.step(before >= 1 ? "left" : "right", mode);
      expect(Number(await page.getByTestId("settings-music").inputValue())).not.toBe(before);
      await pad.tap("east");
      expect(await focusedTestId(page)).toBe("pause-settings");

      // Resume on A, held: the race takes the pad back without fast-falling.
      await pad.walkTo("pause-resume", mode);
      await pad.press("south");
      await expect(page.getByTestId("pause-overlay")).toBeHidden();
      await pad.frames(10);
      expect(await readInput(page)).toMatchObject({ fastFall: false });
      await pad.release("south");

      // Finish, and back to the title.
      await driveRoom(code);
      await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
      await expectFocusSettled(page);
      await pad.walkTo("return-to-menu", mode);
      await pad.tap("south");
      await expectScreen(page, "title");
      await expectFocusSettled(page);
    });

    test("a held Start or stick does not act again across the pause", async ({ page }) => {
      test.slow();
      const pad = await padOnTitle(page);
      await padIntoRace(page, pad, mode);

      // Start held: the overlay opens once and stays open.
      await pad.press("start");
      await expect(page.getByTestId("pause-overlay")).toBeVisible();
      await pad.frames(60);
      await expect(page.getByTestId("pause-overlay")).toBeVisible();
      await pad.release("start");

      // Resume, then pause with the stick/d-pad held down: focus stays put.
      await pad.tap("east");
      await expect(page.getByTestId("pause-overlay")).toBeHidden();
      await pad.hold("down", mode);
      await pad.tap("start");
      await expect(page.getByTestId("pause-overlay")).toBeVisible();
      const first = await focusedTestId(page);
      await pad.frames(60);
      expect(await focusedTestId(page)).toBe(first);
      await pad.letGo("down", mode);
    });
  });
}

test("stick drift on the title moves nothing", async ({ page }) => {
  const pad = await padOnTitle(page);
  await pad.walkTo("title-play", "dpad");
  // Resting just inside the 0.25 radial deadzone, two seconds at each: wall
  // time, as the spec asks and as a resting stick is, not a frame count that
  // a slow browser stretches past the test's budget.
  for (const [x, y] of [
    [0.15, 0.15],
    [0.24, 0],
    [0, -0.24],
    [-0.17, 0.17],
  ] as const) {
    await pad.stick(x, y);
    await page.waitForTimeout(2_000);
    await pad.frames();
    expect(await focusedTestId(page)).toBe("title-play");
  }
  await pad.stick(0, 0);
});

test("unplugging mid-hold stops the walk, and the pad works again once back", async ({ page }) => {
  const pad = await padOnTitle(page);
  await pad.walkTo("title-play", "dpad");
  await pad.hold("down", "dpad");
  await pad.unplug();
  const stopped = await focusedTestId(page);
  await pad.frames(60); // past the 400 ms repeat delay
  expect(await focusedTestId(page)).toBe(stopped);

  await pad.release("dpadDown");
  await pad.connect();
  await pad.step("down", "dpad");
  expect(await focusedTestId(page)).not.toBe(stopped);
});

test("the pad never reaches the browser around the game", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright's WebKit does not grant element fullscreen reliably");
  test.slow();
  const pad = await padOnTitle(page);
  const url = page.url();

  // Watched as it happens, not only at the checks below: any scroll of the
  // document, and any exit from fullscreen, is remembered by the page.
  await page.evaluate(() => {
    const seen = { scrolled: false, leftFullscreen: false };
    (window as unknown as { __ffEscapes: typeof seen }).__ffEscapes = seen;
    document.addEventListener("scroll", () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) seen.scrolled = true;
    });
    document.addEventListener("fullscreenchange", () => {
      if (document.fullscreenElement === null) seen.leftFullscreen = true;
    });
  });

  const expectContained = async (): Promise<void> => {
    const state = await page.evaluate(() => ({
      fullscreen: document.fullscreenElement !== null,
      scroll: [window.scrollX, window.scrollY],
      escapes: (window as unknown as { __ffEscapes: unknown }).__ffEscapes,
      stillHere: (window as unknown as { __ffStillHere?: boolean }).__ffStillHere === true,
    }));
    expect(state).toEqual({
      fullscreen: true,
      scroll: [0, 0],
      escapes: { scrolled: false, leftFullscreen: false },
      stillHere: true,
    });
    expect(page.url()).toBe(url);
  };

  // Entered by a real click, as a player would; the mouse is not used again.
  await page.getByTestId("quick-fullscreen").click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);

  // The leftover-focus case: A straight after the click.
  await pad.tap("south");
  await expectContained();

  // Walk the whole title twice over, both ways.
  for (let i = 0; i < 20; i += 1) await pad.step("down", "stick");
  for (let i = 0; i < 20; i += 1) await pad.step("up", "dpad");
  await expectContained();

  // A settings modal: sliders, then B out.
  await pad.walkTo("title-settings", "dpad");
  await pad.tap("south");
  await pad.walkTo("settings-sfx", "dpad");
  await pad.step("left", "dpad");
  await pad.tap("east");
  await expectContained();

  // Into a race, pause, resume.
  const code = await padIntoRace(page, pad, "dpad");
  await pad.tap("start");
  await pad.tap("east");
  await expectContained();

  // To the results and back to the title: the whole journey, still inside.
  await driveRoom(code);
  await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
  await pad.walkTo("return-to-menu", "dpad");
  await pad.tap("south");
  await expectScreen(page, "title");
  await expectContained();
});

/** Focus is on `testId`, ringed, once the client has had its frame to put it there. */
async function expectPadOn(page: Page, testId: string): Promise<void> {
  await expect.poll(() => focusedTestId(page), { message: `the pad lands on ${testId}` }).toBe(testId);
  await expectFocusSettled(page);
}

test("the pad lands on each screen's green button, never on Mute or Back", async ({ page }) => {
  test.slow();
  const pad = await padOnTitle(page);
  // Nothing has focus yet: the first press lands on Play, not the corner.
  await pad.step("down", "dpad");
  await expectPadOn(page, "title-play");
  await pad.tap("south");
  await expectScreen(page, "lobby");
  await expectPadOn(page, "find-race");
  await pad.walkTo("create-room", "dpad");
  await pad.tap("south");
  await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: 15_000 });
  await expectPadOn(page, "ready-toggle");
  const code = (await page.getByTestId("room-code").textContent()) ?? "";
  await pad.walkTo("mode-floors-20", "dpad");
  await pad.tap("south");
  await expect(page.getByTestId("mode-floors-20")).toHaveAttribute("aria-checked", "true", { timeout: CLIENT_FOLLOWS_MS });
  await holdRoomClocks(code, ["stage", "song"]);
  try {
    await pad.walkTo("ready-toggle", "dpad");
    await pad.tap("south");
    for (const step of ["stage", "song"] as const) {
      await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", step, { timeout: SCREEN_SETTLE_MS });
      await expectPadOn(page, "lock-in");
      await pad.tap("south");
      if (step === "stage") await waitForRoom(code, (now) => now.step === "song", { what: "the song step opens", ticks: REVEAL_TICKS + 30 });
    }
    await waitForRoom(code, (now) => now.phase === "racing", {
      what: "the race begins after the pad locks the song",
      ticks: REVEAL_TICKS + LOADING_TIMEOUT_TICKS + COUNTDOWN_TICKS + 30,
    });
  } finally {
    await holdRoomClocks(code, []);
  }
  await expectScreen(page, "gameplay", SCREEN_SETTLE_MS);
  await pad.tap("start");
  await expectPadOn(page, "pause-resume");
  await pad.tap("east");
  await expect(page.getByTestId("pause-overlay")).toBeHidden();
  await driveRoom(code);
  await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
  await expectPadOn(page, "race-again");
});

test("a dialog the pad opens or closes shows where the pad is", async ({ page }) => {
  const pad = await padOnTitle(page);
  await pad.walkTo("title-settings", "dpad");
  await pad.tap("south");
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  // In it: the first setting, not Close, so A straight away changes nothing.
  await expectPadOn(page, "settings-tab-settings");
  await pad.tap("east");
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
  // Back on the button that opened it, drawn as focused.
  await expectPadOn(page, "title-settings");
});

test("A goes on from the splash, as a tap or a key does", async ({ page }) => {
  const pad = await FakePad.install(page);
  await page.goto("/");
  await passPhotosensitivity(page);
  await expect(page.getByTestId("splash").getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS });
  await pad.connect();
  await pad.tap("south");
  await expectScreen(page, "title");
});

test("a pad joins a friend's room by its code", async ({ browser }) => {
  test.slow();
  const [host, guest] = (await openClients(browser, 2)) as [Page, Page];
  const code = await createRoom(host, "Alpha");
  const pad = await FakePad.install(guest);
  await guest.reload();
  await passSplash(guest);
  await expectScreen(guest, "title");
  await pad.connect();
  await pad.step("down", "dpad");
  await pad.tap("south");
  await expectScreen(guest, "lobby");
  const offer = guest.getByTestId("tutorial-offer-skip");
  if (await offer.isVisible()) {
    await pad.walkTo("tutorial-offer-skip", "dpad");
    await pad.tap("south");
  }
  // A on the code field opens the letter cells: a pad has no keys to type with.
  await pad.walkTo("code-input", "dpad");
  await pad.tap("south");
  await expect(guest.getByTestId("code-editor")).toBeVisible();
  await expectFocusSettled(guest);
  for (const [at, letter] of [...code].entries()) {
    const index = ROOM_CODE_ALPHABET.indexOf(letter);
    // From an empty cell, up starts at the first letter and down at the last: take the shorter way.
    const up = index + 1 <= ROOM_CODE_ALPHABET.length - index;
    for (let step = 0; step < (up ? index + 1 : ROOM_CODE_ALPHABET.length - index); step += 1) await pad.step(up ? "up" : "down", "dpad");
    await expect(guest.getByTestId("code-letter").nth(at)).toHaveText(letter);
    if (at < code.length - 1) await pad.step("right", "dpad");
  }
  await expectPadOn(guest, "code-letter");
  await pad.tap("south");
  await expect(guest.getByTestId("seats")).toContainText("Alpha", { timeout: CLIENT_FOLLOWS_MS });
  await expect(guest.getByTestId("room-code")).toHaveText(code);
});

test("B leaves the room code's cells without joining", async ({ page }) => {
  const pad = await padOnTitle(page);
  await pad.step("down", "dpad");
  await pad.tap("south");
  await expectScreen(page, "lobby");
  await pad.walkTo("code-input", "dpad");
  await pad.tap("south");
  await expect(page.getByTestId("code-editor")).toBeVisible();
  await pad.step("up", "dpad");
  await pad.tap("east");
  await expect(page.getByTestId("code-editor")).toHaveCount(0);
  await expectPadOn(page, "code-input");
  await expectScreen(page, "lobby");
});
