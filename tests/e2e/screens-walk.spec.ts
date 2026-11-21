import { passStudio } from "./support/studio";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "./support/test";
import { SETTINGS_KEY } from "../../apps/client/src/features/profile/settings";
import { COUNTDOWN_TICKS, TICK_HZ } from "../../packages/shared/src/common/constants";
import { serverUpdatingMessage } from "../../packages/shared/src/common/refusals";
import { CLIENT_BOOT_MS, CLIENT_FOLLOWS_MS, RESULTS_TIMEOUT_MS, SCREEN_SETTLE_MS } from "./support/room-driver";
import { SERVER_URL, RoomPatience, driveRoom, holdRoomClocks, waitForRoom, waitForServer } from "./support/server-fixture";
import { startFrameHost, type FrameHost } from "./support/frame-host";
import { MODES, Notes, Shots, WalkDone, evaluateIn, partsOf, selectedViews, waitForIn, walkLocale, type Surface, type View } from "./support/screens-walk";
import { BRIEF, FRAME_CONTROL, stepUntil } from "./support/frame-control";
import { keyHands, playChapter, stepFrames, takeFrames } from "./support/story-play";

/**
 * The screens walk (owner, 2026-11-14: "make FloorFifty's screenshot walk a
 * job we can start remotely"; and "do not begin the visual screen audit until
 * we have EVERY view we need").
 *
 * It photographs every screen of the game on every view: three phones
 * upright and sideways (a small iPhone, a large iPhone, a Pixel), an iPad both
 * ways, two computer windows, each standalone and inside the Ruken frame. It
 * writes `evidence/screens/<view>/<nn>-<screen>.png` (`support/screens-walk.ts`
 * has the numbering) and judges nothing: it captures. Started by
 * `pnpm screens:look` (`tools/screens-look.ts`), locally or in the gate's
 * `screens` job on a GPU pod when a draft commits `tests/e2e/look.json`;
 * never a part of any suite.
 *
 * Every wait is on state: a screen's own marker, the room's tick, a button
 * enabled. The one place it lets time pass is a held key in the story, where holding
 * it for a moment is the input itself and never the wait before a photograph.
 *
 * A step that fails is noted (`_notes-<part>.json`) and the walk goes on, so
 * one broken screen costs one screenshot and not the view. The check that
 * runs after the walk (`screens-walk-check.spec.ts`) fails the job if any
 * screen a view needs is missing.
 *
 * The server is the e2e server, seeded (`FLOOR_FIFTY_TEST_SEED=13`); the
 * story's chapters have their own fixed seeds.
 *
 * `SCREENS_VIEWS` and `SCREENS_HOSTS` narrow a run (`support/screens-walk.ts`).
 */

test.beforeAll(async () => {
  await waitForServer();
});

/** Where the walk may wait for a screen: the select phase and a boot are the longest. */
const SCREEN_MS = 47_500;

type Opened = {
  readonly page: Page;
  /** Where the game is: the page itself, or its frame inside the Ruken host. */
  readonly game: Surface;
  readonly context: BrowserContext;
  close(): Promise<void>;
};

type OpenOptions = {
  /** A returning player: the cards they have already seen, and the walk's language, stored before the game starts. Left out, it is a first visit. */
  seen?: Record<string, boolean>;
  /** Leave `navigator.webdriver` on (the default). Off, the game shows the landscape cover, which it skips under automation. */
  automation?: boolean;
  /** Runs before the game loads: routes that make it fail. */
  beforeLoad?: (context: BrowserContext) => Promise<unknown>;
  /** A player never shown how to climb, so the first Find a race meets the match gate (`support/test.ts` stores the opposite). */
  neverShownHow?: true;
};

/** A browser context in the view's device, with the game loaded in it, standalone or framed by the Ruken host. */
async function open(browser: Browser, view: View, baseURL: string, options: OpenOptions = {}): Promise<Opened> {
  const context = await browser.newContext({ ...view.options, reducedMotion: "reduce" });
  // No action waits for ever: a control that cannot be pressed fails after this and the walk notes it,
  // where an unbounded click would hold a view until the whole test timed out.
  context.setDefaultTimeout(30_000);
  if (options.automation === false) {
    await context.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
      } catch {
        // Already redefined.
      }
    });
  }
  if (options.seen !== undefined) {
    // The game's own language setting, so the screens are what a player who chose it sees.
    await context.addInitScript(
      ({ key, locale, seen }) => {
        try {
          localStorage.setItem(key, JSON.stringify({ version: 2, locale, seen }));
        } catch {
          // A frame without storage starts as a first visit.
        }
      },
      { key: SETTINGS_KEY, locale: walkLocale(), seen: options.seen },
    );
  }
  if (options.neverShownHow === true) {
    // Runs after `support/test.ts`'s own script, which marks every client as shown how; only `seen.tutorial` changes.
    await context.addInitScript((key) => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as { seen?: Record<string, boolean> };
        localStorage.setItem(key, JSON.stringify({ ...stored, seen: { ...stored.seen, tutorial: false } }));
      } catch {
        // A frame without storage starts as a first visit.
      }
    }, SETTINGS_KEY);
  }
  await options.beforeLoad?.(context);
  const page = await context.newPage();
  if (view.host === "standalone") {
    await page.goto("/");
    return { page, game: page, context, close: () => context.close() };
  }
  // A mobile viewport meta on the host page, as a phone-first host has: without it a phone's
  // emulation lays the host out 980 px wide and the game is photographed at a desktop width.
  const host: FrameHost = await startFrameHost({ gameUrl: baseURL, viewportMeta: true });
  try {
    await page.goto(host.url);
    const iframe = page.locator("iframe");
    await iframe.waitFor({ state: "attached", timeout: CLIENT_BOOT_MS });
    const frame = await (await iframe.elementHandle())?.contentFrame();
    if (frame === null || frame === undefined) throw new Error("the Ruken frame has no document");
    return {
      page,
      game: frame,
      context,
      close: async () => {
        await context.close();
        await host.close();
      },
    };
  } catch (error) {
    await context.close();
    await host.close();
    throw error;
  }
}

/** A screen is reached when its root is there and the transition veil has revealed it. */
async function expectScreen(game: Surface, screen: string, timeout = SCREEN_MS): Promise<void> {
  await expect(game.locator(`[data-screen="${screen}"]`)).toBeVisible({ timeout });
  await expect(game.getByTestId("transition-veil")).toHaveCount(0, { timeout: SCREEN_SETTLE_MS });
}

/** Every picture on the screen has loaded (the characters' and stages' art loads on demand). */
async function picturesLoaded(game: Surface): Promise<void> {
  await waitForIn(game, () => [...document.images].every((image) => image.complete));
}

/**
 * Presses a control. Where it cannot be pressed at this size (covered, or
 * off the screen) the press is made by script so the walk can go on, and
 * noted, because a button a player cannot press is itself a finding.
 */
async function press(target: Locator, notes: Notes, label: string): Promise<void> {
  try {
    await target.click({ timeout: 10_000 });
  } catch {
    // A control that leaves the page as it is pressed (a menu that swaps for the next) can fail
    // the click's own follow-up checks after the press has landed: it is gone, so it was pressed.
    if ((await target.count()) === 0) {
      notes.add(`${label} was gone by the time its press finished; taken as pressed`);
      return;
    }
    notes.add(`${label} could not be pressed at this size; pressed by script`);
    await target.dispatchEvent("click", undefined, { timeout: 5_000 });
  }
}

/** The text of a status line or an error panel, once it has any. */
async function statusShown(game: Surface, timeout = SCREEN_SETTLE_MS): Promise<void> {
  const status = game.getByTestId("menu-status").or(game.getByTestId("error-view")).first();
  await expect(status).not.toBeEmpty({ timeout });
}

/**
 * Through the first-visit cards to the title, as a returning or a new player
 * finds them: whichever of the language step, the effects warning and the
 * splash comes up is passed.
 */
async function passToTitle(game: Surface): Promise<void> {
  const language = game.getByTestId("language-first");
  const warning = game.getByTestId("photosensitivity-warning");
  const splash = game.getByTestId("splash");
  await expect(game.getByTestId("studio-splash").or(language).or(warning).or(splash)).toBeVisible({ timeout: CLIENT_BOOT_MS });
  await passStudio(game);
  await expect(language.or(warning).or(splash)).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  if (await language.isVisible()) {
    await language.getByTestId("language-first-continue").dispatchEvent("click");
    await expect(language).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
    await expect(warning.or(splash)).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  }
  if (await warning.isVisible()) {
    await warning.getByTestId("photosensitivity-continue").dispatchEvent("click");
    await expect(warning).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
  }
  await expect(splash.getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS });
  await splash.click();
  await expectScreen(game, "title");
}

/** From the title through Play into the lobby. */
async function enterLobby(game: Surface): Promise<void> {
  await game.getByTestId("title-play").click();
  await expectScreen(game, "lobby");
}

async function createRoom(game: Surface, name: string): Promise<string> {
  await game.getByTestId("name-input").fill(name);
  await game.getByTestId("create-room").click();
  await expect(game.getByTestId("room-code")).not.toBeEmpty({ timeout: SCREEN_SETTLE_MS });
  return ((await game.getByTestId("room-code").textContent()) ?? "").trim();
}

/**
 * Locks in each pick step until the select screen has gone, counted in the
 * room's ticks (`RoomPatience`): a step ends on its tick however the machine
 * is keeping up.
 */
async function passSelect(game: Surface, code: string): Promise<void> {
  const patience = new RoomPatience(code, "the select phase", 90 * TICK_HZ);
  await expect(game.getByTestId("select-screen")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
  for (;;) {
    const lock = game.getByTestId("lock-in");
    if ((await lock.count()) > 0 && (await lock.isEnabled({ timeout: 1_000 }).catch(() => false))) {
      // Forced: the button's width changes with the seconds counting down beside it, so it never holds still.
      await lock.click({ timeout: 2_000, force: true }).catch(() => undefined);
    }
    const reading = await patience.check();
    if (reading.phase !== "select") break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await expect(game.getByTestId("select-screen")).toHaveCount(0, { timeout: SCREEN_SETTLE_MS });
}

/**
 * The stage pick's Lock in, pressed until the roulette's reveal has landed. The
 * room's clocks are held for the photographs, so a press that did not take would
 * leave the step standing for ever; pressing again is what a player does. The
 * reveal has landed once its result is named or the winner's row carries its
 * byline. Where it had to be pressed more than once, or the byline was not
 * there, that is noted: both are findings about the screen.
 */
async function lockInAndReveal(game: Surface, notes: Notes): Promise<void> {
  const lock = game.getByTestId("lock-in");
  const byline = game.getByTestId("roulette-byline");
  const landed = byline.or(game.getByTestId("roulette-result").filter({ hasText: /\S/ })).first();
  const deadline = Date.now() + SCREEN_SETTLE_MS;
  let presses = 0;
  while (!(await landed.isVisible())) {
    if (Date.now() > deadline) throw new Error(`the roulette did not reveal after ${presses} press(es) of Lock in: ${await selectDiagnosis(game)}`);
    if (await lock.isEnabled({ timeout: 1_000 }).catch(() => false)) {
      presses += 1;
      // Forced: the button's width changes with the seconds counting down beside it, so it never holds still.
      await lock.click({ timeout: 2_000, force: true }).catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (presses > 1) notes.add(`the stage pick's Lock in was pressed ${presses} times before the reveal came`);
  if (!(await byline.isVisible())) notes.add("the reveal named its result but the winner's byline was not visible");
}

/** What the select screen is doing, in one line, for a note about why a step did not come. */
async function selectDiagnosis(game: Surface): Promise<string> {
  return evaluateIn(game, () => {
    const lock = document.querySelector<HTMLButtonElement>('[data-testid="lock-in"]');
    const box = lock?.getBoundingClientRect();
    const at = box === undefined ? undefined : document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const screen = document.querySelector('[data-testid="select-screen"]');
    return [
      `step=${screen?.getAttribute("data-step") ?? "none"}`,
      `lock=${lock === null ? "absent" : lock.disabled ? "disabled" : "enabled"}`,
      `window=${innerWidth}x${innerHeight}`,
      `atLock=${at?.tagName ?? "nothing"}${at === null || at === undefined || lock?.contains(at) ? "" : "(covering)"}`,
      `veil=${document.querySelectorAll('[data-testid="transition-veil"]').length}`,
    ].join(" ");
  }).catch(() => "the page could not be read");
}

/** The page's own bounded step: a failure is noted and the walk goes on. */
function stepper(notes: Notes): (name: string, body: () => Promise<void>) => Promise<void> {
  return (name, body) =>
    test.step(name, async () => {
      try {
        await body();
      } catch (error) {
        if (error instanceof WalkDone) throw error;
        // The first line says what failed; the locator line says on what, which the next walk needs to know.
        // Strips the terminal colour codes (ESC [ ... m) from the error text.
        // oxlint-disable-next-line no-control-regex
        const lines = String(error).replace(/\u001b\[[0-9;]*m/g, "").split("\n");
        const locator = lines.find((line) => line.trim().startsWith("Locator:"));
        notes.add(`${name}: ${lines[0]}${locator === undefined ? "" : ` (${locator.trim()})`}`);
      }
    });
}

/** The room's own clock, waited on: the racers are off the ground once the race has run four seconds. */
async function raceUnderway(code: string): Promise<void> {
  const racing = await waitForRoom(code, (reading) => reading.phase === "racing", {
    what: "the race starts",
    ticks: COUNTDOWN_TICKS + 2 * TICK_HZ,
  });
  await waitForRoom(code, (reading) => reading.phase === "racing" && reading.tick >= racing.tick + 4 * TICK_HZ, {
    what: "the racers are off the ground",
    ticks: 6 * TICK_HZ,
  });
}

/** What a part of the walk works with. */
type Walk = {
  readonly page: Page;
  readonly game: Surface;
  readonly notes: Notes;
  readonly step: (name: string, body: () => Promise<void>) => Promise<void>;
  readonly shoot: (screen: string) => Promise<void>;
  /** Puts the game in a finger's wording on a touch view (`Shots.noteTouch`); nothing elsewhere. */
  readonly noteTouch: () => Promise<void>;
};

/** The replay from the results to its end card, with its save and share buttons, and back. */
async function watchReplay({ page, game, notes, step, shoot, noteTouch }: Walk, name: string): Promise<void> {
  await expect(game.getByTestId("watch-replay")).toBeEnabled({ timeout: 30_000 });
  await game.getByTestId("watch-replay").click();
  await expectScreen(game, "replay");
  // The bar says how to bring it back the first time it steps aside, in the words of the input
  // last used, and a key press earlier in the walk left that the keyboard's. A touch event after
  // the bar is idle would wake it, so the finger is noted now, before it goes.
  await noteTouch();
  // Running: the replay has played a few seconds of the race.
  const position = game.getByTestId("replay-progress");
  await expect.poll(async () => Number(await position.inputValue()), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  await shoot(`replay-${name}`);
  // Idle: the bar steps aside after a spell without input.
  await expect(game.getByTestId("replay-controls")).toHaveAttribute("data-idle", "true", { timeout: 30_000 });
  await shoot(`replay-${name}-idle`);
  // On at double speed to the end card.
  await page.keyboard.press("s");
  await expect(game.getByTestId("replay-watch-again")).toBeVisible({ timeout: 180_000 });
  await shoot(`replay-${name}-end`);
  // Save and Share: the share's own answer, said under the buttons.
  await step(`${name} share`, async () => {
    await expect(game.getByTestId("replay-share-video")).toBeEnabled({ timeout: 30_000 });
    await game.getByTestId("replay-share-video").click();
    // The share's answer is a note (the first time) or a status line (when it failed or
    // was refused); a share that went through quietly says nothing. Either way the screen
    // is photographed as it stands, and a silence is noted, because it is a finding.
    const answered = await expect(
      game.getByTestId("replay-share-note").or(game.getByTestId("replay-share-status").filter({ hasText: /\S/ })).first(),
    )
      .toBeVisible({ timeout: 30_000 })
      .then(() => true, () => false);
    if (!answered) notes.add(`${name}: the share said nothing under its buttons within 30 s; photographed as it stands`);
    await shoot(`replay-${name}-share`);
  });
  await press(game.getByTestId("replay-exit").or(game.getByTestId("replay-back")).first(), notes, "the replay's Back to results");
  await expectScreen(game, "game-end", RESULTS_TIMEOUT_MS);
}

for (const view of selectedViews()) {
  test(`${view.key} / main`, async ({ browser, baseURL }) => {
    test.setTimeout(60 * 60_000);
    const notes = new Notes(view, "main");
    test.skip(!partsOf(view).includes("main"), "no screen of this part was asked for");
    const shots = new Shots(view, "main");
    const step = stepper(notes);
    // A first visit: the walk meets the match gate on its first Find a race.
    const opened = await open(browser, view, baseURL ?? "", { neverShownHow: true });
    const { page, game } = opened;
    const shoot = (screen: string): Promise<void> => shots.take(page, game, screen);
    const walk: Walk = { page, game, notes, step, shoot, noteTouch: () => shots.noteTouch(game) };
    try {
      await step("first visit", async () => {
        const language = game.getByTestId("language-first");
        const warning = game.getByTestId("photosensitivity-warning");
        const splash = game.getByTestId("splash");
        await expect(game.getByTestId("studio-splash").or(language).or(warning).or(splash)).toBeVisible({ timeout: CLIENT_BOOT_MS });
        await passStudio(game);
        await expect(language.or(warning).or(splash)).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
        if (await language.isVisible()) {
          await shoot("first-language");
          // The walk's language is picked here, on the step a new player picks it on; the cards after it read in it.
          await press(language.getByTestId(`first-language-${walkLocale()}`), notes, `the ${walkLocale()} flag`);
          await expect(game.locator("html")).toHaveAttribute("lang", walkLocale(), { timeout: CLIENT_FOLLOWS_MS });
          await shoot("first-language-chosen");
          await press(language.getByTestId("language-first-continue"), notes, "the language step's Continue");
          await expect(language).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
          await expect(warning.or(splash)).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
        }
        if (await warning.isVisible()) {
          await shoot("photosensitivity-warning");
          await press(warning.getByTestId("photosensitivity-continue"), notes, "the effects warning's Continue");
          await expect(warning).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
        }
        await expect(splash).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
        await shoot("splash-loading");
        await expect(splash.getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS });
        await shoot("splash-ready");
        await splash.click();
        await expectScreen(game, "title");
        await shoot("title");
      });

      const modal = (opener: string, id: string, screen: string, more?: () => Promise<void>): Promise<void> =>
        step(screen, async () => {
          await press(game.getByTestId(opener), notes, opener);
          await expect(game.getByTestId(id)).toBeVisible({ timeout: SCREEN_SETTLE_MS });
          await shoot(screen);
          await more?.();
          await press(game.getByTestId(id).getByTestId("modal-close"), notes, `${id}'s close`);
          await expect(game.getByTestId(id)).toBeHidden({ timeout: SCREEN_SETTLE_MS });
        });
      await modal("title-settings", "settings-modal", "settings", async () => {
        const scroll = game.getByTestId("settings-modal").locator("[data-scroll-region]").first();
        if ((await scroll.count()) > 0 && (await scroll.evaluate((node) => node.scrollHeight > node.clientHeight))) {
          await scroll.evaluate((node) => node.scrollTo(0, node.scrollHeight));
          await expect.poll(() => scroll.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
          await shoot("settings-scrolled");
        }
        await press(game.getByTestId("settings-tab-controls"), notes, "the settings' Controls tab");
        await shoot("settings-controls");
      });
      await modal("quick-contact", "contact-modal", "contact");
      await modal("title-language", "language-modal", "language");

      await step("character from the title", async () => {
        await press(game.getByTestId("title-character"), notes, "the title's Character button");
        await game.getByTestId("character-page").waitFor({ timeout: SCREEN_SETTLE_MS });
        await picturesLoaded(game);
        await shoot("character-from-title");
        await press(game.getByTestId("character-back"), notes, "the character page's Back");
        await expectScreen(game, "title");
      });

      await step("lobby", async () => {
        await press(game.getByTestId("title-play"), notes, "the title's Play");
        await expectScreen(game, "lobby");
        await shoot("lobby");
      });

      // A first visit: the first press that starts a match is asked once. Show me how opens the Instructions, which count as being shown.
      await step("the match gate and the Instructions", async () => {
        await game.getByTestId("name-input").fill("Nana");
        await press(game.getByTestId("find-race"), notes, "Find a race");
        await expect(game.getByTestId("match-gate")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
        await shoot("match-gate");
        await press(game.getByTestId("match-gate-show"), notes, "the gate's Show me how");
        await expect(game.getByTestId("instructions")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
        await expect(game.getByTestId("instructions-image").or(game.getByTestId("instructions-caption")).first()).toBeVisible({ timeout: SCREEN_SETTLE_MS });
        await shoot("instructions");
        await page.keyboard.press("Escape");
        await expect(game.getByTestId("instructions")).toBeHidden({ timeout: SCREEN_SETTLE_MS });
      });

      await step("join with a wrong code", async () => {
        await game.getByTestId("name-input").fill("Nana");
        await game.getByTestId("code-input").fill("QQQQQQ");
        await press(game.getByTestId("join-room"), notes, "Join room");
        await statusShown(game, 20_000);
        await shoot("join-failed");
        await game.getByTestId("code-input").fill("");
      });

      await step("find a race", async () => {
        await press(game.getByTestId("find-race"), notes, "Find a race");
        await expect(game.getByTestId("room-code").or(game.getByTestId("quick-match-clock")).first()).toBeVisible({ timeout: SCREEN_SETTLE_MS });
        await shoot("find-race-public-room");
        await press(game.getByTestId("leave-room"), notes, "Leave room");
        await expect(game.getByTestId("name-input")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      });

      let code = "";
      await step("private room", async () => {
        code = await createRoom(game, "Nana Josephine");
        await shoot("ready-room-alone");
        for (let seats = 1; seats <= 3; seats += 1) {
          await press(game.getByTestId("seat-add-cpu").first(), notes, "an empty seat's Add CPU");
          await expect(game.getByTestId("seat-remove-cpu")).toHaveCount(seats, { timeout: CLIENT_FOLLOWS_MS });
        }
        await shoot("ready-room-cpus");
        // The rules sheet, open (it replaces the old scrolled settings shot).
        await press(game.getByTestId("ready-rules"), notes, "Rules");
        await game.getByTestId("mode-tagline").waitFor({ timeout: SCREEN_SETTLE_MS });
        await shoot("ready-room-rules");
        await press(game.getByTestId("info-sheet-close"), notes, "the rules sheet's Close");
        await press(game.getByTestId("seat-change"), notes, "the seat's Change");
        await game.getByTestId("character-page").waitFor({ timeout: SCREEN_SETTLE_MS });
        await picturesLoaded(game);
        await shoot("character-from-ready-room");
        await press(game.getByTestId("character-back"), notes, "the character page's Back");
        await expect(game.getByTestId("ready-toggle")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
      });

      // Each mode's race, to its results and its replay. The first also
      // photographs the select screens and the pause menu, which are the
      // same in every mode.
      for (const [index, mode] of MODES.entries()) {
        const first = index === 0;
        await step(`race ${mode.name}`, async () => {
          // A race that stopped part way must not leave the room's clocks held for the next.
          if (code !== "") await holdRoomClocks(code, []);
          await press(game.getByTestId(`mode-${mode.id}`), notes, `the ${mode.name} choice`);
          await expect(game.getByTestId(`mode-${mode.id}`)).toHaveAttribute("aria-checked", "true", { timeout: CLIENT_FOLLOWS_MS });
          await shoot(`ready-room-${mode.name}`);

          if (first) await holdRoomClocks(code, ["stage", "stageReveal", "song"]);
          await game.getByTestId("ready-toggle").click();
          await expect(game.getByTestId("select-screen")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
          if (first) {
            await expect(game.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: SCREEN_SETTLE_MS });
            await picturesLoaded(game);
            await shoot("select-stage");
            await lockInAndReveal(game, notes);
            await shoot("select-roulette");
            await holdRoomClocks(code, ["song"]);
            await waitForRoom(code, (reading) => reading.step === "song", { what: "the song step opens", ticks: 400 });
            await expect(game.getByTestId("song-slide")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
            await picturesLoaded(game);
            await shoot("select-song");
            await holdRoomClocks(code, []);
          }
          await passSelect(game, code);

          await expectScreen(game, "gameplay");
          await expect(game.getByTestId("race-hud")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
          await shoot(`race-${mode.name}-start`);
          await raceUnderway(code);
          await shoot(`race-${mode.name}-hud`);

          if (first) {
            await game.getByTestId("pause-open").click({ timeout: 5_000 }).catch(() => page.keyboard.press("Escape"));
            await expect(game.getByTestId("pause-resume")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
            await shoot("pause");
            await press(game.getByTestId("pause-leave"), notes, "the pause menu's Leave");
            await expect(game.getByTestId("pause-leave-cancel")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
            await shoot("pause-leave-confirm");
            await game.getByTestId("pause-leave-cancel").click();
            await game.getByTestId("pause-resume").click().catch(() => undefined);
            await expect(game.getByTestId("pause-resume")).toBeHidden({ timeout: SCREEN_SETTLE_MS });
          }

          await driveRoom(code, { ticks: 60 * 240 });
          await expectScreen(game, "game-end", RESULTS_TIMEOUT_MS);
          await expect(game.getByTestId("result-row").first()).toBeVisible({ timeout: SCREEN_SETTLE_MS });
          await picturesLoaded(game);
          await shoot(`results-${mode.name}`);

          await watchReplay(walk, mode.name);
          await press(game.getByTestId("race-again"), notes, "Race again");
          await expect(game.getByTestId("ready-toggle")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
        });
      }
    } catch (error) {
      if (!(error instanceof WalkDone)) throw error;
    } finally {
      notes.save();
      await opened.close();
    }
  });

  test(`${view.key} / story`, async ({ browser, baseURL }) => {
    test.setTimeout(30 * 60_000);
    const notes = new Notes(view, "story");
    test.skip(!partsOf(view).includes("story"), "no screen of this part was asked for");
    const shots = new Shots(view, "story");
    const opened = await open(browser, view, baseURL ?? "", { seen: { photosensitivity: true, tutorial: true } });
    const { page, game } = opened;
    const shoot = (screen: string): Promise<void> => shots.take(page, game, screen);
    const words = game.getByTestId("story-line").or(game.getByTestId("story-chip")).first();
    try {
      const step = stepper(notes);

      // The first chapter: the swipe card where a finger plays, the first words, the climb, the pause.
      await step("the story's first chapter", async () => {
        await passToTitle(game);
        await press(game.getByTestId("quick-story"), notes, "the title's Story");
        await expectScreen(game, "story");
        await expect(game.getByTestId("story-hub")).toBeVisible({ timeout: 30_000 });
        await shoot("story-hub");
        await press(game.getByTestId("story-play"), notes, "the hub's Play");
        await expect(game.getByTestId("story-cutscene-box")).toBeVisible({ timeout: 30_000 });
        await shoot("story-cutscene");
        await press(game.getByTestId("story-cutscene-skip"), notes, "the cutscene's Skip");

        const coach = game.getByTestId("swipe-coach");
        if (view.touch && (await expect(coach).toBeVisible({ timeout: 8_000 }).then(() => true, () => false))) {
          await shoot("story-swipe-coach");
          await press(game.getByTestId("swipe-coach-dismiss"), notes, "the swipe card's dismiss");
        }

        await expect(words).toBeVisible({ timeout: 30_000 });
        await shoot("story-line");
        // A key is pressed: the climb is the player's, and the words are in the keyboard's wording from here.
        await page.keyboard.down("KeyD");
        await page.waitForTimeout(600);
        await page.keyboard.up("KeyD");
        await shots.noteTouch(game);
        await shoot("story-playing");

        if ((await game.getByTestId("pause-open").count()) > 0) await press(game.getByTestId("pause-open"), notes, "the story's pause button");
        else await page.keyboard.press("Escape");
        await expect(game.getByTestId("pause-resume")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
        await shoot("story-paused");
        await press(game.getByTestId("pause-resume"), notes, "the pause menu's Resume");
        await expect(game.getByTestId("pause-resume")).toBeHidden({ timeout: SCREEN_SETTLE_MS });
      });
    } catch (error) {
      if (!(error instanceof WalkDone)) throw error;
    } finally {
      notes.save();
      await opened.close();
    }
  });

  // The lava needs a chapter that catches an idle racer: the content the game fetches is rewritten, nothing in the game is.
  const rewritten = (change: (chapters: Record<string, unknown>[]) => Record<string, unknown>[]) => (context: BrowserContext) =>
    context.route("**/content", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { content: { story: { chapters: Record<string, unknown>[] } } };
      body.content.story.chapters = change(body.content.story.chapters);
      await route.fulfill({ response, json: body });
    });

  test(`${view.key} / story end`, async ({ browser, baseURL }) => {
    test.setTimeout(20 * 60_000);
    const notes = new Notes(view, "story-end");
    test.skip(!partsOf(view).includes("story"), "no screen of this part was asked for");
    const shots = new Shots(view, "story");
    // Four chapters done: the last is played to its goal by the story bot on the arrow keys, then the ending and the last card.
    const opened = await open(browser, view, baseURL ?? "", {
      seen: { photosensitivity: true, tutorial: true },
      beforeLoad: async (context) => {
        await context.addInitScript(FRAME_CONTROL);
        await context.addInitScript((key) => {
          try {
            const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
            localStorage.setItem(key, JSON.stringify({ ...stored, version: 2, story: { chaptersDone: 4, chapters: {} } }));
          } catch {
            // A frame without storage starts at chapter 1, and the walk notes it.
          }
        }, SETTINGS_KEY);
      },
    });
    const { page, game } = opened;
    try {
      const step = stepper(notes);
      await step("the story's end", async () => {
        await passToTitle(game);
        await press(game.getByTestId("quick-story"), notes, "the title's Story");
        await expectScreen(game, "story");
        await expect(game.getByTestId("story-hub")).toHaveAttribute("data-selected", "4", { timeout: 30_000 });
        await press(game.getByTestId("story-play"), notes, "the hub's Play");
        await press(game.getByTestId("story-cutscene-skip"), notes, "the cutscene's Skip");
        await expect(game.getByTestId("story-line").or(game.getByTestId("story-chip")).first()).toBeVisible({ timeout: 30_000 });
        await takeFrames(game);
        await playChapter(game, keyHands(page), 6_000, undefined, (line) => notes.add(line));
        await stepFrames(game, 120);
        await expect(game.getByTestId("story-results")).toBeVisible({ timeout: 30_000 });
        await shots.take(page, game, "story-results");
        await press(game.getByTestId("story-next"), notes, "the results' Next");
        await press(game.getByTestId("story-cutscene-skip"), notes, "the ending's Skip");
        await expect(game.getByTestId("story-finale")).toBeVisible({ timeout: 30_000 });
        await stepFrames(game, 240);
        await shots.take(page, game, "story-end");
      });
    } catch (error) {
      if (!(error instanceof WalkDone)) throw error;
    } finally {
      notes.save();
      await opened.close();
    }
  });

  test(`${view.key} / story caught`, async ({ browser, baseURL }) => {
    test.setTimeout(20 * 60_000);
    const notes = new Notes(view, "story-caught");
    test.skip(!partsOf(view).includes("story"), "no screen of this part was asked for");
    const shots = new Shots(view, "story");
    // The lava's chapter alone, left to catch an idle racer.
    const opened = await open(browser, view, baseURL ?? "", {
      seen: { photosensitivity: true, tutorial: true },
      // The snow chapter alone, its lava under the racer from the first tick: an idle racer is caught.
      beforeLoad: async (context) => {
        // Stepped frames: a software-drawn browser plays the lava's minutes at a tenth of real time.
        await context.addInitScript(FRAME_CONTROL);
        await rewritten((chapters) => {
          const snow = chapters[3]! as { startFloor: number; phases: Record<string, unknown>[] };
          const phases = snow.phases.map((phase, index) =>
            index === 0 ? { ...phase, lava: { under: "player", startBelow: 40, rise: 32, grace: 0 }, safeSpots: (phase["safeSpots"] as number[] | undefined) ?? [snow.startFloor] } : phase,
          );
          return [{ ...snow, phases }];
        })(context);
      },
    });
    const { page, game } = opened;
    try {
      const step = stepper(notes);
      await step("the lava catches the racer", async () => {
        await passToTitle(game);
        await press(game.getByTestId("quick-story"), notes, "the title's Story");
        await expectScreen(game, "story");
        await press(game.getByTestId("story-play"), notes, "the hub's Play");
        await press(game.getByTestId("story-cutscene-skip"), notes, "the cutscene's Skip");
        expect(await stepUntil(game, async () => (await game.getByTestId("out-banner").count()) > 0, 6_000, BRIEF.batch, BRIEF.frameMs), "the lava catches the racer").toBe(true);
        await shots.take(page, game, "story-caught");
      });
    } catch (error) {
      if (!(error instanceof WalkDone)) throw error;
    } finally {
      notes.save();
      await opened.close();
    }
  });

  test(`${view.key} / errors`, async ({ browser, baseURL }) => {
    test.setTimeout(20 * 60_000);
    const notes = new Notes(view, "errors");
    test.skip(!partsOf(view).includes("errors"), "no screen of this part was asked for");
    const shots = new Shots(view, "errors");
    const step = stepper(notes);
    const returning = { photosensitivity: true, tutorial: true };
    const toLobby = async (opened: Opened): Promise<void> => {
      await passToTitle(opened.game);
      await enterLobby(opened.game);
    };
    try {
      await step("the server cannot be reached", async () => {
        const opened = await open(browser, view, baseURL ?? "", { seen: returning });
        try {
          await toLobby(opened);
          await opened.context.route((url) => url.href.startsWith(SERVER_URL), (route) => route.abort("connectionrefused"));
          await opened.game.getByTestId("name-input").fill("Nana");
          await press(opened.game.getByTestId("find-race"), notes, "Find a race");
          await statusShown(opened.game, 30_000);
          await shots.take(opened.page, opened.game, "error-server-unreachable");
        } finally {
          await opened.close();
        }
      });

      await step("the game fails to load", async () => {
        const opened = await open(browser, view, baseURL ?? "", {
          seen: returning,
          beforeLoad: (context) => context.route((url) => url.href.startsWith(`${SERVER_URL}/content`), (route) => route.abort("connectionrefused")),
        });
        try {
          await expect(opened.game.getByTestId("boot-error")).toBeVisible({ timeout: CLIENT_BOOT_MS });
          await shots.take(opened.page, opened.game, "error-boot-failed");
        } finally {
          await opened.close();
        }
      });

      await step("the server is updating", async () => {
        const opened = await open(browser, view, baseURL ?? "", { seen: returning });
        try {
          await toLobby(opened);
          // The refusal the server sends while it drains (`serverUpdatingMessage`), with the headers a cross-origin page needs to read it.
          // The origin is echoed, with credentials, as the server's own headers do: a wildcard is refused for a request made with credentials and reads as "unreachable".
          await opened.context.route((url) => url.href.startsWith(`${SERVER_URL}/matchmake/`), (route) => {
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
          await opened.game.getByTestId("name-input").fill("Nana");
          await press(opened.game.getByTestId("create-room"), notes, "Create room");
          await statusShown(opened.game, 30_000);
          await shots.take(opened.page, opened.game, "error-server-updating");
        } finally {
          await opened.close();
        }
      });

      await step("the connection drops in a race", async () => {
        const opened = await open(browser, view, baseURL ?? "", { seen: returning });
        try {
          await toLobby(opened);
          const code = await createRoom(opened.game, "Nana");
          await opened.game.getByTestId("ready-toggle").click();
          await passSelect(opened.game, code);
          await expectScreen(opened.game, "gameplay");
          // The network goes before the transport is dropped, as screen-flow.spec.ts does it.
          await opened.context.setOffline(true);
          await evaluateIn(opened.game, () => window.dispatchEvent(new Event("offline")));
          await expect(opened.game.getByTestId("connection-state")).toBeVisible({ timeout: 15_000 });
          await shots.take(opened.page, opened.game, "error-disconnected");
          // Past the reconnect grace the seat is lost, and the game says so.
          await expect(opened.game.getByTestId("error-view")).toBeVisible({ timeout: 120_000 });
          await shots.take(opened.page, opened.game, "error-seat-lost");
        } finally {
          await opened.close();
        }
      });
    } catch (error) {
      if (!(error instanceof WalkDone)) throw error;
    } finally {
      notes.save();
    }
  });

  if (view.phoneLandscape) {
    test(`${view.key} / cover`, async ({ browser, baseURL }) => {
      test.setTimeout(10 * 60_000);
      const notes = new Notes(view, "cover");
      test.skip(!partsOf(view).includes("cover"), "no screen of this part was asked for");
      const shots = new Shots(view, "cover");
      try {
        await stepper(notes)("the turn upright cover", async () => {
          // The game skips the cover under automation, so this context says it is not automated.
          const opened = await open(browser, view, baseURL ?? "", { seen: { photosensitivity: true }, automation: false });
          try {
            await expect(opened.game.getByTestId("landscape-gate")).toBeVisible({ timeout: CLIENT_BOOT_MS });
            await shots.take(opened.page, opened.game, "turn-upright-cover");
          } finally {
            await opened.close();
          }
        });
      } catch (error) {
        if (!(error instanceof WalkDone)) throw error;
      } finally {
        notes.save();
      }
    });
  }
}
