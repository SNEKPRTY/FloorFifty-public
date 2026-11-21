import { expect, test, type BrowserContext, type Page } from "./support/test";
import { COUNTDOWN_TICKS, LOADING_TIMEOUT_TICKS, REVEAL_TICKS } from "../../packages/shared/src/common/constants";
import { serverUpdatingMessage } from "../../packages/shared/src/common/refusals";
import { FakePad, expectFocusSettled, focusedTestId } from "./support/fake-gamepad";
import {
  CLIENT_BOOT_MS,
  CLIENT_FOLLOWS_MS,
  RESULTS_TIMEOUT_MS,
  SCREEN_SETTLE_MS,
  allowForBoot,
  expectScreen,
  openTitle,
  passSplash,
  seedSettings,
} from "./support/room-driver";
import { SERVER_URL, driveRoom, holdRoomClocks, waitForRoom, waitForServer } from "./support/server-fixture";

/**
 * Every screen a player can reach (the screens walk's catalogue, `SCREENS` in
 * `support/screens-walk.ts`), walked twice: once with only a keyboard (Tab,
 * Enter, Escape) and once with only a pad (the d-pad, A and B). On each screen
 * and sheet focus lands where the player can see it, every control can be
 * reached, an open sheet keeps focus in, and the way back gets out.
 *
 * Not walked: the cover a phone held sideways shows (it has no control). A mouse or a test hook only sets up a
 * fault (a refused server, a dropped network); every step the player takes
 * is a key or a pad press.
 */

test.beforeAll(async () => {
  await waitForServer();
});

type Input = "keyboard" | "pad";

/** One way of playing: move to a control and press it, or go back. */
interface Hands {
  readonly name: Input;
  /** Moves focus to the control, every stop drawn, never leaving an open sheet. */
  reach(testId: string): Promise<void>;
  /** Moves focus once, as a player looking around would. */
  next(): Promise<void>;
  press(): Promise<void>;
  back(): Promise<void>;
  /**
   * A new screen is up. The pad's focus is already on one of its controls,
   * drawn; a keyboard's focus may rest on the page until the next Tab, as
   * any web page does, and each Tab after it is checked as it goes.
   */
  arrived(): Promise<void>;
  /** Pauses the race: Escape, or Start. */
  pause(): Promise<void>;
  /** The pad itself, for a step only a pad has (stepping a letter up). */
  readonly pad?: FakePad;
}

/**
 * After a Tab: on a control, drawn as focused and inside any open sheet. Past
 * the page's last control Tab goes out to the browser for one stop, as on any
 * web page, unless a sheet is open, which keeps it in.
 */
async function expectTabStopDrawn(page: Page): Promise<void> {
  const stop = await page.evaluate(() => {
    const active = document.activeElement;
    const dialog = document.querySelector('[aria-modal="true"]');
    const onPage = active !== null && active !== document.body;
    return {
      at: `${(active as HTMLElement | null)?.dataset["testid"] ?? active?.tagName} in ${[...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].map((node) => node.dataset["testid"]).join(",")}`,
      leftForBrowser: !onPage && dialog === null,
      drawn: onPage && active.matches(":focus-visible"),
      inDialog: dialog === null || (active !== null && dialog.contains(active)),
    };
  });
  expect(stop.leftForBrowser || (stop.drawn && stop.inDialog), `a Tab stop is drawn and kept in: ${JSON.stringify(stop)}`).toBe(true);
}

function keyboardHands(page: Page): Hands {
  return {
    name: "keyboard",
    async reach(testId) {
      for (let stops = 0; stops <= 80; stops += 1) {
        if ((await focusedTestId(page)) === testId) return;
        await page.keyboard.press("Tab");
        await expectTabStopDrawn(page);
      }
      throw new Error(`Tab never reached ${testId}`);
    },
    next: async () => {
      await page.keyboard.press("Tab");
      await expectTabStopDrawn(page);
    },
    press: () => page.keyboard.press("Enter"),
    back: () => page.keyboard.press("Escape"),
    arrived: async () => undefined,
    pause: () => page.keyboard.press("Escape"),
  };
}

function padHands(page: Page, pad: FakePad): Hands {
  return {
    name: "pad",
    pad,
    reach: (testId) => pad.walkTo(testId, "dpad", 80),
    next: () => pad.step("down", "dpad"),
    press: () => pad.tap("south"),
    back: () => pad.tap("east"),
    arrived: () => expectFocusSettled(page),
    pause: () => pad.tap("start"),
  };
}

/** Hands for a page that has not loaded yet: a pad is installed before the load and plugged in after it. */
async function handsFor(page: Page, input: Input, load: () => Promise<void>): Promise<Hands> {
  if (input === "keyboard") {
    await load();
    return keyboardHands(page);
  }
  const pad = await FakePad.install(page);
  await load();
  await pad.connect();
  return padHands(page, pad);
}

/** Opens the title with the hands ready. */
function titleWith(page: Page, input: Input): Promise<Hands> {
  return handsFor(page, input, () => openTitle(page));
}

/** The focused control is inside `testId`, drawn, and fully on screen. */
async function expectFocusInside(page: Page, testId: string): Promise<void> {
  await expectFocusSettled(page);
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const active = document.activeElement as HTMLElement | null;
          const sheet = document.querySelector(`[data-testid="${id}"]`);
          const box = active?.getBoundingClientRect();
          return {
            inside: sheet !== null && active !== null && sheet.contains(active),
            onScreen: box !== undefined && box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth,
          };
        }, testId),
      { message: `focus stays inside ${testId}, on screen` },
    )
    .toEqual({ inside: true, onScreen: true });
}

/**
 * Every control in `within` (the open sheet, or the whole screen), reached
 * one stop at a time with the hands' own "next": Tab, or the d-pad's down.
 * Each control is numbered first, so two with one test id still count apart.
 * A row of cells that keep up and down for their own value is walked with
 * the pad's right, as a player would.
 * A roster of chips counts as reached once one chip is: the pad steers
 * through the rest of its grid with the d-pad (`gamepad.spec.ts`). The
 * story hub's row of chapters is the same: one card reached, the pad goes
 * along the rest with left and right (`gamepad.spec.ts`).
 */
async function reachEvery(page: Page, hands: Hands, within?: string): Promise<void> {
  const total = await page.evaluate((id) => {
    const root: ParentNode = id === undefined ? document : (document.querySelector(`[data-testid="${id}"]`) ?? document);
    const controls = [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => {
      if (element.tabIndex < 0 || (element as HTMLButtonElement).disabled || element.closest("[inert], [hidden]") !== null) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
    });
    document.querySelectorAll("[data-walk-stop]").forEach((element) => element.removeAttribute("data-walk-stop"));
    const grouped = (element: HTMLElement): string | undefined =>
      element.closest('[data-testid="tile-grid"]') !== null ? "grid" : element.closest('[data-testid="story-hub"] [role="group"]') !== null ? "chapters" : undefined;
    controls.forEach((element, index) => element.setAttribute("data-walk-stop", grouped(element) ?? String(index)));
    return controls.length;
  }, within);
  expect(total, `${within ?? "the screen"} has controls`).toBeGreaterThan(0);
  const seen = new Set<string>();
  // Twice round is plenty for Tab; the pad's down goes round a grid of chips by rows.
  for (let step = 0; step < total * 2 + 4; step += 1) {
    const before = await page.evaluate(() => document.activeElement?.getAttribute("data-walk-stop") ?? null);
    await hands.next();
    // Down on a cell that steps its own value (a code letter, a seed digit)
    // changes the value; the pad walks along such a row with right.
    if (hands.pad !== undefined && before !== null && (await page.evaluate(() => document.activeElement?.getAttribute("data-walk-stop") ?? null)) === before) {
      await hands.pad.step("right", "dpad");
    }
    if (within !== undefined) await expectFocusInside(page, within);
    const stop = await page.evaluate(() => document.activeElement?.getAttribute("data-walk-stop") ?? null);
    if (stop !== null) seen.add(stop);
  }
  const missed = await page.evaluate(
    (reached) =>
      [...document.querySelectorAll<HTMLElement>("[data-walk-stop]")]
        .filter((element) => !reached.includes(element.getAttribute("data-walk-stop")!))
        .map((element) => element.dataset["testid"] ?? `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}"`),
    [...seen],
  );
  expect(missed, `every control in ${within ?? "the screen"} is reached by ${hands.name}`).toEqual([]);
}

/**
 * Opens a sheet from `opener`, reaches every control in it without falling
 * out, then goes back and finds focus, drawn, on the opener again.
 */
async function visitSheet(page: Page, hands: Hands, opener: string, sheet: string, inside?: () => Promise<void>): Promise<void> {
  await hands.reach(opener);
  await hands.press();
  await expect(page.getByTestId(sheet)).toBeVisible({ timeout: SCREEN_SETTLE_MS });
  await expectFocusInside(page, sheet);
  await reachEvery(page, hands, sheet);
  await inside?.();
  await hands.back();
  await expect(page.getByTestId(sheet)).toHaveCount(0, { timeout: SCREEN_SETTLE_MS });
  await expect.poll(() => focusedTestId(page), { message: `back on ${opener} after ${sheet}` }).toBe(opener);
  await expectFocusSettled(page);
}

/** From the title into the lobby. */
async function intoLobby(page: Page, hands: Hands): Promise<void> {
  await hands.reach("title-play");
  await hands.press();
  await expectScreen(page, "lobby");
  await hands.arrived();
}

/** The lobby's notice says what went wrong; the hands reach its Close and it goes. */
async function closeNotice(page: Page, hands: Hands): Promise<void> {
  await expect(page.getByTestId("menu-status")).not.toBeEmpty({ timeout: 30_000 });
  await hands.arrived();
  await reachEvery(page, hands);
  await hands.reach("menu-status-close");
  await hands.press();
  await expect(page.getByTestId("menu-status")).toBeHidden({ timeout: SCREEN_SETTLE_MS });
  await hands.arrived();
}

/** Ready, then Lock in on the stage and the song, by the hands alone; `each` runs on each step before its Lock in. */
async function lockBoth(page: Page, hands: Hands, code: string, each?: (step: "stage" | "song") => Promise<void>): Promise<void> {
  await holdRoomClocks(code, ["stage", "song"]);
  try {
    await hands.reach("ready-toggle");
    await hands.press();
    await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: SCREEN_SETTLE_MS });
    for (const step of ["stage", "song"] as const) {
      await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", step, { timeout: SCREEN_SETTLE_MS });
      await hands.arrived();
      await each?.(step);
      await hands.reach("lock-in");
      await hands.press();
      if (step === "stage") await waitForRoom(code, (now) => now.step === "song", { what: "the song step opens", ticks: REVEAL_TICKS + 30 });
    }
    await waitForRoom(code, (now) => now.phase === "racing", {
      what: "the race begins once the song is locked",
      ticks: REVEAL_TICKS + LOADING_TIMEOUT_TICKS + COUNTDOWN_TICKS + 30,
    });
  } finally {
    await holdRoomClocks(code, []);
  }
}

const TITLE_SHEETS = [
  { opener: "title-settings", sheet: "settings-modal" },
  { opener: "title-character", sheet: "character-page" },
  { opener: "title-language", sheet: "language-modal" },
  { opener: "quick-contact", sheet: "contact-modal" },
  { opener: "quick-instructions", sheet: "instructions" },
] as const;

for (const input of ["keyboard", "pad"] as const) {
  test.describe(`with only the ${input}`, () => {
    test("a first visit: the language, the effects warning and the splash", async ({ page }) => {
      allowForBoot();
      const hands = await handsFor(page, input, async () => {
        await page.goto("/");
        await expect(page.getByTestId("studio-splash").or(page.getByTestId("language-first"))).toBeVisible({ timeout: CLIENT_BOOT_MS });
      });
      if (await page.getByTestId("studio-splash").isVisible()) {
        await hands.press();
        await expect(page.getByTestId("studio-splash")).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
      }
      const language = page.getByTestId("language-first");
      await expect(language).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      await hands.arrived();
      await reachEvery(page, hands, "language-first");
      await hands.reach("language-first-continue");
      await hands.press();
      const warning = page.getByTestId("photosensitivity-warning");
      await expect(warning).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
      await hands.arrived();
      await reachEvery(page, hands, "photosensitivity-warning");
      await hands.reach("photosensitivity-continue");
      await hands.press();
      await expect(warning).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
      await expect(page.getByTestId("splash").getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS });
      await hands.press();
      await expectScreen(page, "title");
      await hands.arrived();
      await reachEvery(page, hands);
    });

    test("every sheet on the title opens, keeps focus and gives it back", async ({ page }) => {
      test.slow();
      const hands = await titleWith(page, input);
      for (const { opener, sheet } of TITLE_SHEETS) await visitSheet(page, hands, opener, sheet);
      // Settings' second tab, the controls.
      await visitSheet(page, hands, "title-settings", "settings-modal", async () => {
        await hands.reach("settings-tab-controls");
        await hands.press();
        await expect(page.getByTestId("settings-tab-controls")).toHaveAttribute("aria-selected", "true");
        await reachEvery(page, hands, "settings-modal");
      });
      await expectScreen(page, "title");
    });

    test("the story: the hub's and the pause's controls are reached, Leave goes to the hub, and Back to the title", async ({ page }) => {
      test.slow();
      const hands = await titleWith(page, input);
      await hands.reach("quick-story");
      await hands.press();
      await expectScreen(page, "story");
      await expect(page.getByTestId("story-hub")).toBeVisible({ timeout: CLIENT_BOOT_MS });
      await hands.arrived();
      // The whole screen: the hub is all of it, and Tab goes on past its last control as on the title.
      await reachEvery(page, hands);
      // Back along the row to chapter 1, the one open: the pad's left, or the arrow key.
      await hands.reach("story-chapter-card");
      for (let step = 0; step < 4; step += 1) await (hands.pad === undefined ? page.keyboard.press("ArrowLeft") : hands.pad.step("left", "dpad"));
      await expect(page.getByTestId("story-hub")).toHaveAttribute("data-selected", "0");
      await hands.reach("story-play");
      await hands.press();
      await expect(page.getByTestId("story-cutscene")).toBeVisible({ timeout: CLIENT_BOOT_MS });
      await hands.reach("story-cutscene-skip");
      await hands.press();
      await expect(page.getByTestId("story-line").or(page.getByTestId("story-chip")).first()).toBeVisible({ timeout: CLIENT_BOOT_MS });
      await hands.pause();
      await expect(page.getByTestId("pause-overlay")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.arrived();
      await reachEvery(page, hands, "pause-overlay");
      await hands.reach("pause-leave");
      await hands.press();
      await expect(page.getByTestId("story-hub")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.reach("story-hub-back");
      await hands.press();
      await expectScreen(page, "title", SCREEN_SETTLE_MS);
    });

    test("the first-match gate: its controls are reached, Show me how opens Instructions, and Skip goes on", async ({ page }) => {
      test.slow();
      await seedSettings(page.context(), { seen: { tutorial: false } });
      const hands = await titleWith(page, input);
      await intoLobby(page, hands);
      await page.getByTestId("name-input").fill("Granny");
      await hands.reach("create-room");
      await hands.press();
      await expect(page.getByTestId("match-gate")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.arrived();
      await reachEvery(page, hands, "match-gate");
      await hands.reach("match-gate-show");
      await hands.press();
      await expect(page.getByTestId("instructions")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.arrived();
      await reachEvery(page, hands, "instructions");
      await hands.back();
      await expect(page.getByTestId("instructions")).toHaveCount(0, { timeout: SCREEN_SETTLE_MS });
      // Shown how, so the next Create goes straight in.
      await hands.reach("create-room");
      await hands.press();
      await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: SCREEN_SETTLE_MS });
    });

    test("the lobby: a wrong code, Find a race, and back to the title", async ({ page }) => {
      test.slow();
      const hands = await titleWith(page, input);
      await intoLobby(page, hands);
      await reachEvery(page, hands);

      // A code no room has: typed, or set a letter at a time on the pad's cells.
      await hands.reach("code-input");
      if (hands.pad === undefined) {
        await page.keyboard.type("AAAAAA");
        await hands.reach("join-room");
        await hands.press();
      } else {
        await hands.press();
        await expect(page.getByTestId("code-editor")).toBeVisible();
        await reachEvery(page, hands, "code-editor");
        // Onto the cells, then left along them to the first.
        await hands.reach("code-letter");
        const cellAt = (): Promise<number> => page.evaluate(() => [...document.querySelectorAll('[data-testid="code-letter"]')].indexOf(document.activeElement as Element));
        for (let steps = await cellAt(); steps > 0; steps -= 1) await hands.pad.step("left", "dpad");
        expect(await cellAt(), "the pad reaches the first letter cell").toBe(0);
        // Up steps each cell's letter (an empty one to the first); right moves on. No room has the code it makes.
        for (let cell = 0; cell < 6; cell += 1) {
          await hands.pad.step("up", "dpad");
          if (cell < 5) await hands.pad.step("right", "dpad");
        }
        for (let cell = 0; cell < 6; cell += 1) await expect(page.getByTestId("code-letter").nth(cell)).toHaveText(/^[A-Z2-9]$/);
        await hands.press();
      }
      await closeNotice(page, hands);

      // Find a race seats the player in a public room; Leave room comes back.
      await hands.reach("find-race");
      await hands.press();
      await expect(page.getByTestId("room-code").or(page.getByTestId("quick-match-clock")).first()).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.arrived();
      await reachEvery(page, hands);
      await hands.reach("leave-room");
      await hands.press();
      await expect(page.getByTestId("name-input")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.arrived();

      await hands.back();
      await expectScreen(page, "title");
      await hands.arrived();
    });

    test("from the title to the results and the replay, and home again", async ({ page }) => {
      test.slow();
      const hands = await titleWith(page, input);
      await intoLobby(page, hands);
      await hands.reach("create-room");
      await hands.press();
      await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: 15_000 });
      const code = (await page.getByTestId("room-code").textContent()) ?? "";
      await hands.arrived();

      // The ready room: a CPU in, every control, the rules and changing your racer.
      await hands.reach("seat-add-cpu");
      await hands.press();
      await expect(page.getByTestId("seat-remove-cpu")).toHaveCount(1, { timeout: CLIENT_FOLLOWS_MS });
      await hands.arrived();
      await reachEvery(page, hands);
      await visitSheet(page, hands, "ready-rules", "ready-rules-sheet");
      await visitSheet(page, hands, "seat-change", "character-page");
      await hands.reach("mode-floors-20");
      await hands.press();
      await expect(page.getByTestId("mode-floors-20")).toHaveAttribute("aria-checked", "true", { timeout: CLIENT_FOLLOWS_MS });

      await lockBoth(page, hands, code, async (step) => {
        await reachEvery(page, hands);
        if (step === "song") return;
        // The seed: Random goes to Classic, and a second press opens the editor.
        await hands.reach("seed-chip");
        await hands.press();
        await expect(page.getByTestId("seed-chip")).toHaveAttribute("data-choice", "classic", { timeout: CLIENT_FOLLOWS_MS });
        await visitSheet(page, hands, "seed-chip", "seed-editor");
      });
      await expectScreen(page, "gameplay", SCREEN_SETTLE_MS);

      // Pause: its menu, its settings, Leave's question answered No, and back to the race.
      await hands.pause();
      await expect(page.getByTestId("pause-overlay")).toBeVisible();
      await expectFocusInside(page, "pause-overlay");
      await reachEvery(page, hands, "pause-overlay");
      await hands.reach("pause-settings");
      await hands.press();
      await expect(page.getByTestId("pause-settings-back")).toBeVisible();
      await expectFocusInside(page, "pause-overlay");
      await reachEvery(page, hands, "pause-overlay");
      await hands.back();
      await expect.poll(() => focusedTestId(page)).toBe("pause-settings");
      await hands.reach("pause-leave");
      await hands.press();
      await expect(page.getByTestId("pause-leave-cancel")).toBeVisible();
      await expectFocusInside(page, "pause-overlay");
      await reachEvery(page, hands, "pause-overlay");
      await hands.reach("pause-leave-cancel");
      await hands.press();
      await expect.poll(() => focusedTestId(page)).toBe("pause-leave");
      await hands.back();
      await expect(page.getByTestId("pause-overlay")).toBeHidden();

      await driveRoom(code);
      await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
      await hands.arrived();
      await expect(page.getByTestId("watch-replay")).toBeEnabled({ timeout: 60_000 });
      await reachEvery(page, hands);

      // The replay: every control, each pressed, then share and back.
      await hands.reach("watch-replay");
      await hands.press();
      await expect(page.getByTestId("replay-controls")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.arrived();
      await reachEvery(page, hands);
      for (const control of ["replay-play", "replay-speed", "replay-follow-next", "replay-restart"]) {
        await hands.reach(control);
        await hands.press();
        await expectFocusSettled(page);
      }
      await expect(page.getByTestId("replay-share-video")).toBeEnabled({ timeout: 30_000 });
      await hands.reach("replay-share-video");
      await hands.press();
      // The share's outcome, or its note, says what happened (a browser here cannot share a video).
      await expect
        .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-replay-share]")].some((note) => !note.hidden && /\S/.test(note.textContent ?? ""))), { timeout: 30_000 })
        .toBe(true);
      await expectFocusSettled(page);
      await hands.reach("replay-exit");
      await hands.press();
      await expect(page.getByTestId("replay-controls")).toHaveCount(0, { timeout: SCREEN_SETTLE_MS });
      await hands.arrived();

      // Race again, back in the room; then out, and home.
      await hands.reach("race-again");
      await hands.press();
      await expect(page.getByTestId("ready-toggle")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.arrived();
      await hands.reach("leave-room");
      await hands.press();
      await expect(page.getByTestId("name-input")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      await hands.arrived();
      await hands.back();
      await expectScreen(page, "title");
      await hands.arrived();
    });

    test.describe("when things go wrong", () => {
      /** A refusal from the server's matchmaker, with the headers a cross-origin page needs to read it. */
      async function refuseAsUpdating(context: BrowserContext): Promise<void> {
        await context.route((url) => url.href.startsWith(`${SERVER_URL}/matchmake/`), (route) => {
          const cors = {
            "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
            "access-control-allow-credentials": "true",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "*",
          };
          return route.request().method() === "OPTIONS"
            ? route.fulfill({ status: 204, headers: cors })
            : route.fulfill({ status: 503, headers: cors, contentType: "application/json", body: JSON.stringify({ code: 503, error: serverUpdatingMessage() }) });
        });
      }

      test("the server cannot be reached, or is updating", async ({ page, context }) => {
        const hands = await titleWith(page, input);
        await intoLobby(page, hands);
        await context.route((url) => url.href.startsWith(SERVER_URL), (route) => route.abort("connectionrefused"));
        await hands.reach("find-race");
        await hands.press();
        await closeNotice(page, hands);
        await context.unrouteAll({ behavior: "ignoreErrors" });
        await refuseAsUpdating(context);
        await hands.reach("create-room");
        await hands.press();
        await closeNotice(page, hands);
      });

      test("the game fails to load", async ({ page, context }) => {
        allowForBoot();
        await seedSettings(context, { seen: { photosensitivity: true } });
        await context.route((url) => url.href.startsWith(`${SERVER_URL}/content`), (route) => route.abort("connectionrefused"));
        const hands = await handsFor(page, input, async () => {
          await page.goto("/");
          await expect(page.getByTestId("boot-error")).toBeVisible({ timeout: CLIENT_BOOT_MS });
        });
        await page.evaluate(() => ((window as unknown as { __ffBefore: boolean }).__ffBefore = true));
        await hands.reach("boot-retry");
        // The press reloads the page under the pad's own write; the reload is what is checked.
        await hands.press().catch(() => undefined);
        // Try again reloads the page, which fails the same way while the server stays away.
        await expect
          .poll(() => page.evaluate(() => (window as unknown as { __ffBefore?: boolean }).__ffBefore ?? false).catch(() => true), { timeout: CLIENT_BOOT_MS })
          .toBe(false);
        await expect(page.getByTestId("boot-error")).toBeVisible({ timeout: CLIENT_BOOT_MS });
      });

      test("the connection drops in a race and the seat is lost", async ({ page, context }) => {
        test.slow();
        const hands = await handsFor(page, input, async () => {
          await page.goto("/");
          await passSplash(page);
          await expectScreen(page, "title");
        });
        await intoLobby(page, hands);
        await hands.reach("create-room");
        await hands.press();
        await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: 15_000 });
        const code = (await page.getByTestId("room-code").textContent()) ?? "";
        await lockBoth(page, hands, code);
        await expectScreen(page, "gameplay", SCREEN_SETTLE_MS);
        // The network goes first, then the transport notices.
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        await expect(page.getByTestId("connection-state")).toBeVisible({ timeout: 15_000 });
        // Past the reconnect grace the seat is lost: the game goes back to the title and says so.
        await expect(page.getByTestId("error-view")).toBeVisible({ timeout: 120_000 });
        await context.setOffline(false);
        await expectScreen(page, "title");
        await hands.arrived();
        await reachEvery(page, hands);
        await hands.reach("error-dismiss");
        await hands.press();
        await expect(page.getByTestId("error-view")).toHaveCount(0, { timeout: SCREEN_SETTLE_MS });
        await hands.arrived();
      });
    });
  });
}
