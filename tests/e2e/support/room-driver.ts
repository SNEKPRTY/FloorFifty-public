/**
 * Page-level room actions.
 *
 * Every helper drives the real interface: it types into the real inputs and
 * clicks the real buttons a player would. Nothing here reaches past the UI into
 * the client's internals, so a passing spec is evidence the interface works.
 *
 * What a helper waits on is state, never a guess at how long the state takes.
 * Where the room's own clock decides (a select step, a reveal, the countdown) it
 * asks the room, through the test driver, and counts its patience in the room's
 * ticks; where a page only has to follow, it waits for the page, with a bound
 * that is a stall's length and not a healthy run's (the constants below).
 */

import { passStudio } from "./studio";
import { expect, test, type Page } from "@playwright/test";
import type { LocaleTag } from "../../../apps/client/src/features/i18n/locales";
import {
  COUNTDOWN_TICKS,
  LOADING_TIMEOUT_TICKS,
  REVEAL_TICKS,
  SELECT_STEP_TICKS,
} from "../../../packages/shared/src/common/constants";
import { describeCoverage, isBlank } from "./pixels";
import { watchMatchmaking } from "./matchmaking-watch";
import { RoomPatience, holdRoomClocks, roomExists, waitForRoom, type ClockName } from "./server-fixture";

/*
 * How long is long enough, and why these numbers.
 *
 * The browser suite shares one PC with whatever else it runs. On the nightly of
 * 2026-10-09 the e2e server logged 2 182 stalls of its own timer: median 177 ms,
 * 90th percentile 2.0 s, the longest 14.5 s, and in one catch-up "dropped
 * 4 483 ms of room time". The pages lose time the same way, and a page that is
 * compiling its first frame holds its main thread, so it answers nothing, not
 * even Playwright's own question, for as long as the GPU takes. A wait shorter
 * than the longest stall is a coin toss on such a night, and one longer than it
 * costs a passing run nothing: a wait returns the moment its state is true. The
 * bound is only how long a failing run takes to say so.
 *
 * Where a wait is on something the room's clock decides, a bound in seconds is
 * the wrong unit altogether, and the helpers below count the room's ticks.
 */

/**
 * How long a page may take to follow something that has already happened: a
 * seat the room has added, a step it has moved to. A stall and a little more.
 * Playwright's own `expect` default is 5 s, which is below the stalls above, so
 * a wait on a page following the room names this.
 */
export const CLIENT_FOLLOWS_MS = 20_000;

/**
 * How long a page may take to enter a screen and draw it: the lobby after a
 * join, the veil lifting off the stage whose first frame is compiling shaders.
 * Twice a stall, because the screen's own work comes after the stall.
 */
export const SCREEN_SETTLE_MS = 30_000;

/**
 * How long a client may take to boot, from page load to the splash asking for
 * its tap. A client with no GPU measured 31 s to the title here; on a GPU
 * machine under load it is the splash's fonts, its bundles and the menu
 * song's download behind the same stalls.
 */
export const CLIENT_BOOT_MS = 60_000;

/** What each client a test opens adds to the test's own time: a boot, and the dialogs before it. */
const CLIENT_BOOT_ALLOWANCE_MS = 90_000;

/**
 * Room ticks Ready to the countdown's end may take, past which the room is
 * broken and not slow: two pick steps and their reveals, loading, the
 * countdown, and half a second to spare.
 */
const SELECT_PHASE_TICKS = SELECT_STEP_TICKS * 2 + REVEAL_TICKS * 2 + LOADING_TIMEOUT_TICKS + COUNTDOWN_TICKS + 30;

/** The room each page last created or joined, so a helper handed only pages can ask the room about them. */
const roomsOfPages = new WeakMap<Page, string>();

/** The code of the room `page` last created or joined, if it did so through these helpers. */
export function roomOf(page: Page): string | undefined {
  return roomsOfPages.get(page);
}

/**
 * Holds the named clocks of the room `page` is in, and lets every other go
 * (`holdRoomClocks`). Held before a step begins, the step opens and stays as it
 * opened; a spec lets go of the clock when it wants the room to move on.
 */
export async function holdClocks(page: Page, names: readonly ClockName[]): Promise<void> {
  const code = roomOf(page);
  if (code === undefined) throw new Error("holdClocks: this page has not created or joined a room through the helpers");
  await holdRoomClocks(code, names);
}

/** Waits for the client to settle on a screen. */
export async function expectScreen(
  page: Page,
  screen: string,
  // The select phase (two pick steps and their reveals, loading and the countdown) sits between Ready and the race; SELECT_TIMEOUT_MS.
  timeout = 47_500,
): Promise<void> {
  await expect(page.locator(`[data-screen="${screen}"]`)).toBeVisible({ timeout });
  // A screen is reached when a player can see it: a liquid edge enters the
  // screen under the veil and reveals it after (race-flow spec §7.3).
  await expectVeilGone(page, `the veil over ${screen} has revealed it`);
}

/**
 * The veil is off the page. It lifts as soon as the screen under it has drawn a
 * frame, and the first frame of a stage is the slow one: the nightly's "veil
 * still present after 5 s" came back as `Received: undefined`, the page unable
 * to answer, not a veil that was slow to fade (its fade is 100 ms under reduced
 * motion).
 */
export async function expectVeilGone(page: Page, message: string): Promise<void> {
  await expect(page.getByTestId("transition-veil"), message).toHaveCount(0, { timeout: SCREEN_SETTLE_MS });
}

/**
 * How long a client may take to follow the room into the results.
 *
 * Longer than an ordinary screen wait, and deliberately so: this one is not
 * "did a menu render" but "did four browser contexts, each drawing a bloomed
 * canvas, receive and act on the finishing snapshot of a race the server has
 * just simulated end to end". The assertion is unchanged -- every client still
 * has to get there -- only the patience is.
 */
export const RESULTS_TIMEOUT_MS = 45_000;

/**
 * A client's boot is part of what a test asks of the machine, so it is part of
 * the test's time too: each boot, a page's first load or a reload, adds
 * `CLIENT_BOOT_ALLOWANCE_MS` to it. A test that opens four clients then has the
 * time four boots can take, and not what two did on the night the limit was
 * chosen. Every wait inside still has its own bound, so a client that never
 * boots fails by name long before the allowance is spent.
 */
export function allowForBoot(): void {
  const info = test.info();
  info.setTimeout(info.timeout + CLIENT_BOOT_ALLOWANCE_MS);
}

/**
 * Goes on past the first visit's language step and photosensitivity warning,
 * which a device sees before its first splash, leaving the language and the
 * effects as they are. Where the device has read them already, the splash
 * comes up instead, and that is all this waits for.
 */
export async function passPhotosensitivity(page: Page): Promise<void> {
  allowForBoot();
  const language = page.getByTestId("language-first");
  const warning = page.getByTestId("photosensitivity-warning");
  const studio = page.getByTestId("studio-splash");
  await expect(studio.or(language).or(warning).or(page.getByTestId("splash"))).toBeVisible({ timeout: CLIENT_BOOT_MS });
  await passStudio(page);
  await expect(language.or(warning).or(page.getByTestId("splash"))).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  if (await language.isVisible()) {
    await language.getByTestId("language-first-continue").click();
    await expect(language).toHaveCount(0, { timeout: CLIENT_FOLLOWS_MS });
    await expect(warning).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
  }
  if (await warning.isVisible()) {
    await warning.getByTestId("photosensitivity-continue").click();
    await expect(warning).toHaveCount(0);
  }
}

/**
 * Taps through the splash once it asks for the tap. It waits for one, because
 * the tap is the gesture that starts the menu music.
 */
export async function passSplash(page: Page): Promise<void> {
  await passPhotosensitivity(page);
  const splash = page.getByTestId("splash");
  // By the prompt's state, not its words: the splash speaks the player's language.
  await expect(splash.getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS }).catch(async (error: unknown) => {
    // Says where the load stopped, so a splash that never asks for the tap
    // names its stage (smoke "a friend joins by code", once, 2026-11-18).
    throw new Error(`${await splashStage(page).catch(() => "splash stage unreadable")}\n${String(error)}`);
  });
  await splash.click();
}

/**
 * Where the splash's load stands: the loading moments it has reached
 * (`loading-trace.ts`: `splash-shown`, `menu-ready`), its bar, whether it has
 * said it is slow, which dialog, alert or screen the overlay holds, and the slowest
 * finished downloads.
 */
async function splashStage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const moments = ((window as unknown as { __ffLoading?: { name: string; at: number }[] }).__ffLoading ?? []).map((moment) => `${moment.name}@${moment.at}`);
    const bar = document.querySelector('[data-testid="splash-progress"]')?.getAttribute("aria-valuenow") ?? "none";
    const slow = document.querySelector('[data-testid="splash-slow"]')?.textContent?.trim() ?? "";
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map((node) => node.getAttribute("data-testid") ?? node.tagName);
    const overlay = document.querySelector("[data-screen]")?.getAttribute("data-screen") ?? "none";
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim().replace(/\s+/g, " ") ?? "").filter((text) => text !== "");
    const downloads = performance.getEntriesByType("resource").map((entry) => entry as PerformanceResourceTiming).sort((a, b) => b.duration - a.duration).slice(0, 5).map((entry) => `${entry.name.split("/").pop()} ${Math.round(entry.startTime)}-${Math.round(entry.responseEnd)} ms`);
    return `splash stage at ${Date.now()}: moments [${moments.join(", ")}], bar ${bar}%, slow line "${slow}", dialogs [${dialogs.join(", ")}], alerts [${alerts.join(" | ")}], overlay ${overlay}, slowest downloads [${downloads.join("; ")}]`;
  });
}

/** Loads the client and taps through the splash to the title. */
export async function openTitle(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await passSplash(page);
  await expectScreen(page, "title");
}

/** Loads the client and goes through Play into the lobby, as a player does. */
export async function openClient(page: Page, path = "/"): Promise<void> {
  await openTitle(page, path);
  await enterLobby(page);
}

/** From the title, through Play into the lobby. */
export async function enterLobby(page: Page): Promise<void> {
  await page.getByTestId("title-play").click();
  await expectScreen(page, "lobby");
}

/**
 * Stores settings for every page the context opens, before any script runs.
 *
 * The specs written for the on-screen buttons seed `touchMode: "buttons"`:
 * swipe is the touch default (launch polish D6), and those specs are about
 * the buttons.
 */
/**
 * Seeds this device's unlock progress (`floor-fifty.progress.v1`, unlockables
 * spec §5) before any script runs: the conditions already earned, and the
 * items already seen, so a race grants nothing a test is not about. `pending`
 * conditions wait in the queue, oldest first, for the next rounds' grants.
 */
export async function seedProgress(
  context: import("@playwright/test").BrowserContext,
  progress: { unlocked: string[]; pending?: string[]; revealed?: string[]; matchesFinished?: number },
): Promise<void> {
  await context.addInitScript((value) => {
    window.localStorage.setItem(
      "floor-fifty.progress.v1",
      JSON.stringify({
        version: 1,
        seq: value.unlocked.length + (value.pending ?? []).length,
        unlocked: value.unlocked,
        pending: (value.pending ?? []).map((id, seq) => ({ id, seq })),
        stats: { matchesFinished: value.matchesFinished ?? 0 },
        counted: [],
        slot: null,
        revealed: value.revealed ?? [],
      }),
    );
  }, progress);
}

export async function seedSettings(
  context: import("@playwright/test").BrowserContext,
  patch: {
    input?: { touchMode: "swipe" | "buttons" };
    seen?: Record<string, boolean>;
    display?: { quality: "high" | "medium" | "low" };
    /** A language choice; null is Automatic (languages spec §3.3). */
    locale?: LocaleTag | null;
  },
): Promise<void> {
  await context.addInitScript((value) => {
    const key = "floor-fifty.settings.v1";
    let stored: Record<string, unknown> = {};
    try {
      stored = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    } catch {
      stored = {};
    }
    const merged: Record<string, unknown> = { ...stored, version: 2 };
    for (const [section, fields] of Object.entries(value)) {
      // `locale` is a scalar, copied across; every other entry is a section, merged.
      merged[section] =
        fields === null || typeof fields !== "object"
          ? fields
          : { ...(stored[section] as object | undefined), ...(fields as object) };
    }
    window.localStorage.setItem(key, JSON.stringify(merged));
  }, patch);
}

/** Finds a race (quick match) and returns the room code it landed in. */
export async function findRace(page: Page, name: string): Promise<string> {
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("find-race").click();
  await expectSeated(page);
  // The code fills in just after the seats, as `createRoom` in the driver waits for.
  await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: CLIENT_FOLLOWS_MS });
  return rememberRoom(page, (await page.getByTestId("room-code").textContent()) ?? "");
}

/** Remembers the room `page` is in, so a helper handed only its pages can ask the room. */
function rememberRoom(page: Page, code: string): string {
  roomsOfPages.set(page, code);
  return code;
}

/**
 * The page is in a room: its seats are showing. A room that refused the
 * player says so in the menu's status line, and the wait stops there with the
 * reason, not after its whole bound with "seats not found".
 */
async function expectSeated(page: Page): Promise<void> {
  const seats = page.getByTestId("seats");
  const refusal = page.locator('[data-testid="menu-status"][data-tone="problem"]');
  await expect(seats.or(refusal)).toBeVisible({ timeout: SCREEN_SETTLE_MS });
  if (await refusal.isVisible()) throw new Error(`the room did not seat the player: ${(await refusal.textContent()) ?? ""}`);
}

/** Creates a room and returns the code the server issued. */
export async function createRoom(page: Page, name: string): Promise<string> {
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("room-code")).not.toBeEmpty({ timeout: SCREEN_SETTLE_MS });
  return rememberRoom(page, (await page.getByTestId("room-code").textContent()) ?? "");
}

/**
 * Joins the room `code` as `name`, as a player does: both fields, and Join.
 *
 * The lobby answers every refusal it has no better words for, a reset
 * connection and an expired seat reservation among them, with "There is no
 * room with that code." One run of the nightly's selection (37961541682) was
 * told that by a room the server had just made for it, once in about two
 * hundred joins, and could not be made to say it again in four hundred and
 * forty more (the cause is not known; the lobby's catch-all copy is a product
 * follow-up). A join that fails therefore fails here at once and loudly, with
 * the evidence to tell the causes apart: the page's own matchmaking calls
 * (`matchmaking-watch.ts`) and whether the server has the room at all
 * (`/__test__/room`, 404 when it does not). It is never pressed again: a
 * second press would turn a player's false "no room" into a passing run.
 */
export async function joinRoom(page: Page, code: string, name: string): Promise<void> {
  const watch = watchMatchmaking(page);
  try {
    await page.getByTestId("name-input").fill(name);
    await page.getByTestId("code-input").fill(code);
    await page.getByTestId("join-room").click();
    const seats = page.getByTestId("seats");
    const refusal = page.locator('[data-testid="menu-status"][data-tone="problem"]');
    await expect(seats.or(refusal)).toBeVisible({ timeout: SCREEN_SETTLE_MS }).catch(async (error: unknown) => {
      throw new Error(await explainJoin(page, watch.lines, code, name, "the seats never showed"), { cause: error });
    });
    if (await refusal.isVisible()) throw new Error(await explainJoin(page, watch.lines, code, name, `the lobby said "${(await refusal.textContent()) ?? ""}"`));
    rememberRoom(page, code);
  } finally {
    watch.stop();
  }
}

/** What a failed join knows: what the page said, what the matchmaker answered, and whether the server has the room. */
async function explainJoin(page: Page, heard: readonly string[], code: string, name: string, said: string): Promise<string> {
  const there = await roomExists(code).then(
    (yes) => (yes ? "the server HAS this room" : "the server has NO such room"),
    (error: unknown) => `the server could not be asked about the room (${String(error)})`,
  );
  const url = page.url();
  return `${name}'s join of ${code} failed: ${said}; ${there}; the page's matchmaking calls: [${heard.join("; ") || "none heard"}] (${url})`;
}

/**
 * How long a client may take from Ready to the race: the stage step and its
 * reveal, loading and the countdown (30 s), plus the song step's 15 s and its
 * reveal's 2.5 s (select spec §5.1).
 */
export const SELECT_TIMEOUT_MS = 47_500;

/** Marks every supplied page ready: the last one opens the select screen. */
export async function readyOnly(pages: Page[]): Promise<void> {
  for (const page of pages) await page.getByTestId("ready-toggle").click();
}

/**
 * Presses Lock in, on the real button, without waiting for it to hold still.
 *
 * Playwright waits for a button to have the same box on two frames running,
 * and this one never does at a second a frame: the seconds counting down
 * beside it change its width by a couple of pixels every second (measured on a
 * page drawing one frame a second: four frames, four different boxes, 860.4 to
 * 858.1 across), so on a page drawing slowly every pair of frames straddles a
 * tick and the click is retried until the step ends. That is the nightly's
 * "lock-in click missed" lines, more than forty of them. The button is 350 px wide and the press
 * lands at its centre, so a button that moved two pixels is still pressed;
 * whether it was is the room's to say, and every caller goes on to wait for it.
 */
export async function pressLockIn(page: Page, timeout = CLIENT_FOLLOWS_MS): Promise<void> {
  await page.getByTestId("lock-in").click({ timeout, force: true });
}

/**
 * Locks the stage step on every page and waits out its reveal, into the song
 * step. The reveal runs on the room's clock, so the wait for the song step is
 * the room's: it has `REVEAL_TICKS` of its own time to get there, however long
 * that takes by the wall, and the pages then have a page's time to follow.
 */
export async function lockStage(pages: Page[]): Promise<void> {
  for (const page of pages) {
    await expect(page.getByTestId("select-screen"), "the stage step opens").toHaveAttribute("data-step", "stage", { timeout: SCREEN_SETTLE_MS });
  }
  for (const page of pages) await pressLockIn(page);
  const code = roomOf(pages[0]!);
  if (code !== undefined) {
    const reading = await waitForRoom(code, (now) => now.step !== "stage" && now.step !== "stageReveal", {
      what: "the song step opens after the stage reveal",
      ticks: REVEAL_TICKS + 30,
    });
    expect(reading.step, "the room is in the song step, and was not already past it").toBe("song");
  }
  for (const page of pages) {
    await expect(page.getByTestId("select-screen"), "the song step opens after the stage reveal").toHaveAttribute("data-step", "song", { timeout: CLIENT_FOLLOWS_MS });
  }
}

/**
 * Locks in every pick step on every page until each has left the select
 * screen. A pick step runs on a 15 s clock, so this keeps pressing Lock in as
 * each step opens; it is over when the room has left select and the pages have
 * followed.
 *
 * Where the pages came into their room through these helpers, the room says
 * when it has left select and has `SELECT_PHASE_TICKS` of its own time to do
 * it: its steps and reveals are counted in ticks, and on a stalled machine the
 * wall's 47.5 s is a different amount of them every night. A page that stays
 * on select after the room has left it has a page's time to follow.
 */
export async function passSelect(pages: Page[]): Promise<void> {
  const code = roomOf(pages[0]!);
  const patience = code === undefined ? undefined : new RoomPatience(code, "passSelect", SELECT_PHASE_TICKS);
  const wallDeadline = Date.now() + SELECT_TIMEOUT_MS;
  let lastAsked = 0;
  let roomLeftAt: number | undefined;
  for (const page of pages) {
    await expect(page.getByTestId("select-screen"), "the select screen opens after Ready").toBeVisible({
      timeout: SCREEN_SETTLE_MS,
    });
  }
  for (;;) {
    let anyOpen = false;
    for (const page of pages) {
      const lock = page.getByTestId("lock-in");
      // Bounded too: the button can go between the count and this check as a
      // step ends, and an unbounded check waits for it to come back.
      if ((await lock.count()) > 0 && (await lock.isEnabled({ timeout: 1_000 }).catch(() => false))) {
        // Bounded: the button can leave the page mid-click as a step ends, and
        // an unbounded click would wait out the whole test for it.
        await lock.click({ timeout: 2_000, force: true }).catch(async (error: unknown) => {
          const where = await page.evaluate(() => {
            const box = document.querySelector('[data-testid="lock-in"]')?.getBoundingClientRect();
            const lobby = document.querySelector('[data-testid="lobby"]');
            return { box: box && [box.x, box.y, box.width, box.height], vh: innerHeight, scroll: lobby?.scrollTop };
          }).catch(() => undefined);
          console.log(`passSelect: lock-in click missed ${JSON.stringify(where)} ${String(error).split("\n")[0]}`);
        });
        anyOpen = true;
      }
    }
    const inSelect = await Promise.all(pages.map((page) => page.getByTestId("select-screen").count()));
    if (inSelect.every((count) => count === 0)) return;
    if (patience === undefined) {
      if (Date.now() >= wallDeadline) throw new Error(`passSelect: the room did not leave the select screen within ${SELECT_TIMEOUT_MS / 1000} s`);
    } else if (Date.now() - lastAsked >= 1_000) {
      lastAsked = Date.now();
      const reading = await patience.check();
      if (reading.phase !== "select") roomLeftAt ??= Date.now();
      if (roomLeftAt !== undefined && Date.now() - roomLeftAt > SCREEN_SETTLE_MS) {
        throw new Error(`passSelect: the room is ${reading.phase}, and ${inSelect.filter((count) => count > 0).length} page(s) still show the select screen ${SCREEN_SETTLE_MS / 1000} s on`);
      }
    }
    if (!anyOpen) await pages[0]!.waitForTimeout(200);
  }
}

/**
 * Focuses `stage` on the stage step. The dot is the direct route; if a layout
 * keeps it out of reach, the next arrow walks the carousel round to it. Either
 * way the panel must end up showing the stage, or the capture would be filed
 * under the wrong name.
 *
 * A stage already showing needs no click. The step opens on the first stage,
 * and a phone held sideways shows a counter where the other layouts show dots,
 * so there is no dot to click and the click waits out all of its 5 s. A
 * four-seat room picking one seat after another then takes longer than the
 * stage step's 15 s clock, and the step moves on without the last seats (the
 * frame budget's four-racer case failed that way on the landscape project).
 */
export async function pickStage(page: Page, stage: string): Promise<void> {
  const picker = page.getByTestId("picker");
  if ((await picker.getAttribute("data-id")) !== stage) {
    await page
      .getByTestId("picker-dot")
      .and(page.locator(`[data-id=${stage}]`))
      .click({ timeout: 5_000 })
      .catch(() => undefined);
  }
  for (let turn = 0; turn < 8 && (await picker.getAttribute("data-id")) !== stage; turn += 1) {
    await page.getByTestId("picker-next").click();
  }
  await expect(picker, `the stage step focuses ${stage}`).toHaveAttribute("data-id", stage, { timeout: 5_000 });
}

/**
 * Brings `id` into the picker on either step. The dot is the direct route
 * where there are dots; past nine items the position is a counter (UI layout
 * spec §6.4), and the next arrow walks the carousel round to it instead.
 */
export async function turnPickerTo(page: Page, id: string): Promise<void> {
  const picker = page.getByTestId("picker");
  const dot = page.getByTestId("picker-dot").and(page.locator(`[data-id=${id}]`));
  if ((await dot.count()) > 0) await dot.click({ timeout: 5_000 }).catch(() => undefined);
  for (let turn = 0; turn < 20 && (await picker.getAttribute("data-id")) !== id; turn += 1) {
    await page.getByTestId("picker-next").click();
  }
  await expect(picker, `the picker shows ${id}`).toHaveAttribute("data-id", id, { timeout: 5_000 });
}

/** Everyone readies and the race begins: Ready, then through the select screen. */
export async function readyAll(pages: Page[]): Promise<void> {
  await readyOnly(pages);
  await passSelect(pages);
}

/** The host's Floors choice (race-options spec §3.4); waits for the room to confirm it. */
export async function chooseMode(page: Page, modeId: string): Promise<void> {
  await page.getByTestId(`mode-${modeId}`).click();
  await expect(page.getByTestId(`mode-${modeId}`)).toHaveAttribute("aria-checked", "true");
}

/**
 * A room of `seats` clients raced to Results: created, joined, the mode
 * chosen, readied through select, and driven to the finish by the test
 * driver. Returns the pages, host first, and the room code.
 */
export async function finishRace(
  browser: import("@playwright/test").Browser,
  options: { modeId?: string; seats?: number; hostName?: string; settings?: Parameters<typeof seedSettings>[1] } & ClientShape = {},
): Promise<{ pages: Page[]; code: string }> {
  const { driveRoom } = await import("./server-fixture");
  const pages = await openClients(browser, options.seats ?? 2, options.settings, options);
  const code = await createRoom(pages[0]!, options.hostName ?? "Alpha");
  for (const [index, page] of pages.slice(1).entries()) await joinRoom(page, code, `Racer${index + 2}`);
  if (options.modeId !== undefined) await chooseMode(pages[0]!, options.modeId);
  await readyAll(pages);
  for (const page of pages) await expectScreen(page, "gameplay");
  const outcome = await driveRoom(code, { ticks: 60 * 240 });
  expect(outcome.phase, "the driver finishes the race").toBe("finished");
  for (const page of pages) await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
  return { pages, code };
}

/**
 * The device a client opens as: its context (viewport, touch, density) and,
 * for a phone's large-text setting, a root font scale (2 is 200%).
 */
export type ClientShape = { context?: import("@playwright/test").BrowserContextOptions; rootFontScale?: number };

/** Opens `count` clients, each in its own context so sessions do not share. */
export async function openClients(
  browser: import("@playwright/test").Browser,
  count: number,
  settings?: Parameters<typeof seedSettings>[1],
  shape: ClientShape = {},
): Promise<Page[]> {
  const pages: Page[] = [];
  for (let index = 0; index < count; index += 1) {
    const context = await browser.newContext(shape.context);
    if (settings !== undefined) await seedSettings(context, settings);
    if (shape.rootFontScale !== undefined) {
      await context.addInitScript((scale) => {
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.style.fontSize = `${100 * scale}%`;
        });
      }, shape.rootFontScale);
    }
    const page = await context.newPage();
    await openClient(page);
    pages.push(page);
  }
  return pages;
}

/** Asserts that two elements' bounding boxes do not overlap. */
export async function expectNoOverlap(page: Page, a: string, b: string): Promise<void> {
  const first = await page.locator(a).boundingBox();
  const second = await page.locator(b).boundingBox();

  expect(first, `${a} has no box`).not.toBeNull();
  expect(second, `${b} has no box`).not.toBeNull();
  if (first === null || second === null) return;

  const overlaps =
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;

  expect(overlaps, `${a} overlaps ${b}`).toBe(false);
}

/**
 * Fails when the touch controls reach into the band the HUD is drawn in.
 *
 * The controls are meant to sit over the canvas -- that is what an overlay is --
 * so overlapping the canvas proves nothing. What must not happen is that they
 * cover elapsed time, the lap counter, or the roster, all of which the renderer
 * draws along the top of the logical viewport.
 */
export async function expectClearOfHud(page: Page, hudBandFraction = 0.35): Promise<void> {
  const canvas = await page.locator("#app canvas").first().boundingBox();
  const controls = await page.getByTestId("touch-controls").boundingBox();

  expect(canvas, "no canvas").not.toBeNull();
  expect(controls, "no touch controls").not.toBeNull();
  if (canvas === null || controls === null) return;

  const hudBandBottom = canvas.y + canvas.height * hudBandFraction;
  expect(
    controls.y,
    `touch controls start at ${controls.y.toFixed(0)}, inside the HUD band above ${hudBandBottom.toFixed(0)}`,
  ).toBeGreaterThan(hudBandBottom);
}

/**
 * Fails when the canvas drew nothing.
 *
 * Reads the pixels rather than the element: a renderer that dies after clearing
 * still leaves a correctly sized canvas, and every screenshot of it is a picture
 * of a failed render. The measurement is taken from a screenshot of the canvas
 * region, because WebGL discards its drawing buffer after compositing unless
 * the context asked to keep it, and turning that on in production for the sake
 * of a test would be the tail wagging the dog.
 *
 * "Drew nothing" is a state the canvas stays in, not a moment. A canvas whose
 * first frame has not reached the compositor yet screenshots as one flat
 * colour, which is what the nightly's "1 distinct colour, 0.0% painted" was on
 * a page still compiling its shaders; a renderer that has died stays that way.
 * So it is measured until it paints, and fails with what the last look found
 * if it never does within a page's time to draw.
 */
export async function expectCanvasHasPixels(page: Page): Promise<void> {
  const canvas = page.locator("#app canvas").first();
  await expect(canvas).toBeVisible();

  await expect
    .poll(
      async () => {
        const box = await canvas.boundingBox();
        if (box === null || box.width <= 0 || box.height <= 0) return "the canvas has no box to screenshot";
        const shot = await page.screenshot({ clip: box });
        return isBlank(shot) ? `the canvas drew nothing: ${describeCoverage(shot)}` : "painted";
      },
      { timeout: SCREEN_SETTLE_MS, intervals: [250, 500, 1_000], message: "the canvas never drew" },
    )
    .toBe("painted");
}
