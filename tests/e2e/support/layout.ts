import { expect, type Browser, type Page } from "@playwright/test";
import { REVEAL_TICKS } from "../../../packages/shared/src/common/constants";
import {
  CLIENT_FOLLOWS_MS,
  SCREEN_SETTLE_MS,
  chooseMode,
  createRoom,
  expectScreen,
  holdClocks,
  joinRoom,
  openClients,
  openTitle,
  passSelect,
  pressLockIn,
  readyOnly,
  RESULTS_TIMEOUT_MS,
  seedSettings,
} from "./room-driver";
import { driveRoom, waitForRoom } from "./server-fixture";

/**
 * Layout invariants (responsive parity spec §4), measured the way a player
 * meets them: without scrolling, at the centre of the thing they would tap.
 *
 * Every assertion here is soft. The sweep walks one flow through four
 * screens, and a hard failure on the menu would hide every failure after it:
 * the red baseline would list one line per viewport, and a task that fixes the
 * results could not see them pass until the race screen before them did.
 */

/** Fully on screen, and what a tap at its centre actually hits. */
export async function expectReachable(page: Page, testId: string): Promise<void> {
  const locator = page.getByTestId(testId);
  await expect.soft(locator, `${testId} is not visible`).toBeVisible();
  if (!(await locator.isVisible())) return;
  const found = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      width: window.innerWidth,
      height: window.innerHeight,
      hit: hit !== null && (hit === node || node.contains(hit)),
    };
  });
  expect.soft(found.top, `${testId} starts above the screen`).toBeGreaterThanOrEqual(0);
  expect.soft(found.left, `${testId} starts left of the screen`).toBeGreaterThanOrEqual(0);
  expect.soft(found.bottom, `${testId} is below the fold`).toBeLessThanOrEqual(found.height + 0.5);
  expect.soft(found.right, `${testId} runs off the right edge`).toBeLessThanOrEqual(found.width + 0.5);
  expect.soft(found.hit, `${testId} is covered or clipped at its centre`).toBe(true);
}

/**
 * Every visible control is on screen, unless it sits in a region that scrolls,
 * and on a touch form factor is at least `minTarget` square: a checkbox or
 * radio counting its label, which presses it too.
 */
export async function expectControlsFit(page: Page, minTarget: number): Promise<void> {
  const problems = await page.evaluate((min) => {
    const out: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>("button, input, [role='button']")) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden") continue;
      // An inert subtree cannot be reached: a carousel's off-screen pages.
      if (node.closest("[inert]") !== null) continue;
      const name = node.dataset["testid"] ?? (node.textContent ?? "").trim().slice(0, 24) ?? node.tagName;
      const scrolls = node.closest("[data-scroll-region]") !== null;
      const off = rect.left < -0.5 || rect.top < -0.5 || rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5;
      if (off && !scrolls) out.push(`${name} is off screen`);
      // A checkbox or radio is pressed through its label as well, so the
      // label is its target: the settings' 22 px boxes sit in 44 px rows.
      const input = node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio") ? node : undefined;
      const target = (input?.labels?.[0] ?? undefined)?.getBoundingClientRect() ?? rect;
      if (min > 0 && (target.width < min - 0.5 || target.height < min - 0.5)) {
        out.push(`${name} is ${Math.round(target.width)}x${Math.round(target.height)}`);
      }
    }
    return out;
  }, minTarget);
  expect.soft(problems).toEqual([]);
}

/**
 * Every seat and result row is tall enough for what it holds. A row squeezed
 * by a short screen clips its own content (the rows hide their overflow), so
 * a crushed roster still passes every reachability check: the gate found one
 * showing only the tops of its portraits (round 2).
 */
export async function expectRowsWhole(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    for (const row of document.querySelectorAll<HTMLElement>("[data-testid='seat'], [data-testid='result-row']")) {
      if (row.scrollHeight > row.clientHeight + 1) {
        out.push(`${row.dataset["testid"]} "${(row.textContent ?? "").trim().slice(0, 16)}" clips ${row.scrollHeight - row.clientHeight}px`);
      }
    }
    return out;
  });
  expect.soft(problems).toEqual([]);
}

/** Labels at least `label` px; on touch, inputs at least `input` px so iOS does not zoom. */
export async function expectTextSizes(page: Page, sizes: { label: number; input: number }): Promise<void> {
  const problems = await page.evaluate(({ label, input }) => {
    const out: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>("body *")) {
      const hasText = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim() !== "");
      if (!hasText || node.getBoundingClientRect().width === 0) continue;
      if (node.closest("[data-testid='net-stats']") !== null) continue;
      const size = parseFloat(getComputedStyle(node).fontSize);
      if (size < label) out.push(`"${node.textContent!.trim().slice(0, 24)}" is ${size}px`);
    }
    for (const node of document.querySelectorAll<HTMLInputElement>("input")) {
      const size = parseFloat(getComputedStyle(node).fontSize);
      if (size < input) out.push(`input ${node.dataset["testid"] ?? ""} is ${size}px`);
    }
    return out;
  }, sizes);
  expect.soft(problems).toEqual([]);
}

/**
 * A box, or `null` at once when nothing matches. `boundingBox()` alone waits
 * for the element to appear, so a missing one spent the whole test timeout and
 * hid every screen after it.
 */
async function boxOf(page: Page, selector: string) {
  const locator = page.locator(selector);
  return (await locator.count()) === 0 ? null : locator.first().boundingBox();
}

/** Two elements' boxes do not overlap. A soft `expectNoOverlap`. */
export async function expectApart(page: Page, a: string, b: string): Promise<void> {
  const first = await boxOf(page, a);
  const second = await boxOf(page, b);
  expect.soft(first, `${a} has no box`).not.toBeNull();
  expect.soft(second, `${b} has no box`).not.toBeNull();
  if (first === null || second === null) return;
  const overlaps =
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height;
  expect.soft(overlaps, `${a} overlaps ${b}`).toBe(false);
}

/** The document itself never scrolls (spec §4.5). Panels may scroll inside. */
export async function expectNoDocumentScroll(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const root = document.documentElement;
    return { sh: root.scrollHeight, ch: root.clientHeight, sw: root.scrollWidth, cw: root.clientWidth };
  });
  expect.soft(size.sh, "the page scrolls vertically").toBeLessThanOrEqual(size.ch);
  expect.soft(size.sw, "the page scrolls horizontally").toBeLessThanOrEqual(size.cw);
}

/** A reference viewport (responsive parity spec §2.1) and what it should classify as. */
export type Sweep = { width: number; height: number; factor: string; touch: boolean };

export const SWEEP: readonly Sweep[] = [
  { width: 360, height: 640, factor: "phone-portrait", touch: true },
  { width: 375, height: 667, factor: "phone-portrait", touch: true },
  { width: 390, height: 844, factor: "phone-portrait", touch: true },
  { width: 430, height: 932, factor: "phone-portrait", touch: true },
  { width: 667, height: 375, factor: "phone-landscape", touch: true },
  { width: 844, height: 390, factor: "phone-landscape", touch: true },
  { width: 932, height: 430, factor: "phone-landscape", touch: true },
  // The in-browser sideways sizes (780 x 270, 844 x 340, 667 x 320) were cut
  // on 2026-10-16: phone landscape is supported full screen only.
  { width: 1280, height: 480, factor: "phone-landscape", touch: false },
  // A small laptop window or a half-screen browser: a desktop short enough
  // to lose its menu below the fold (UI audit B3, 2026-10-02).
  { width: 900, height: 600, factor: "desktop", touch: false },
  { width: 1280, height: 720, factor: "desktop", touch: false },
  { width: 1440, height: 900, factor: "desktop", touch: false },
  { width: 1180, height: 820, factor: "desktop", touch: true },
  { width: 744, height: 1133, factor: "tablet-portrait", touch: true },
  { width: 820, height: 1180, factor: "tablet-portrait", touch: true },
  { width: 1024, height: 1366, factor: "tablet-portrait", touch: true },
];

/** Seat one's name: `PLAYER_NAME_MAX_LENGTH` is 16 (Review focus 3). */
export const LONG_NAME = "Wolfgang-Amadeus";

export type FlowScreen = "title" | "menu" | "ready room" | "select" | "song" | "reveal" | "race" | "results";

/**
 * One full room at `sweep`'s viewport, through every screen: the title, the
 * lobby's connect form ("menu"), a
 * ready room of four (seat one long-named), the stage step, its reveal, the
 * song step, a race, and the results.
 * `visit` runs on each screen, from the host's page; getting from one screen
 * to the next is hard, because a flow that cannot reach the results has
 * nothing to report. Shared by the layout sweep and the evidence run.
 */
export type WalkOptions = {
  /** Settings merged over the walk's own (the languages suite seeds a locale). */
  settings?: Omit<Parameters<typeof seedSettings>[1], "input">;
  /** A device pixel ratio for the host's context: 200% browser zoom is a halved viewport at DPR 2. */
  deviceScaleFactor?: number;
  /** Scales the root font size, as a phone's large-text setting does (languages spec §6.4). */
  rootFontScale?: number;
};

export async function walkFlow(
  browser: Browser,
  sweep: Sweep,
  visit: (screen: FlowScreen, page: Page) => Promise<void>,
  options: WalkOptions = {},
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: sweep.width, height: sweep.height },
    hasTouch: sweep.touch,
    isMobile: sweep.touch && sweep.factor !== "desktop",
    reducedMotion: "reduce",
    ...(options.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: options.deviceScaleFactor }),
  });
  // The sweep was drawn for the on-screen buttons; swipe has its own checks.
  await seedSettings(context, { ...options.settings, input: { touchMode: "buttons" } });
  if (options.rootFontScale !== undefined) {
    await context.addInitScript((scale) => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = `${100 * scale}%`;
      });
    }, options.rootFontScale);
  }
  const others: Page[] = [];
  try {
    const page = await context.newPage();
    await openTitle(page);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("data-form-factor", sweep.factor);
    await visit("title", page);
    await page.getByTestId("title-play").click();
    await expectScreen(page, "lobby");
    await visit("menu", page);

    others.push(...(await openClients(browser, 3)));
    const code = await createRoom(page, LONG_NAME);
    await joinRoom(others[0]!, code, "Sable");
    await joinRoom(others[1]!, code, "Wren");
    await joinRoom(others[2]!, code, "Koi");
    await expect(page.getByTestId("seat-name").nth(3)).toHaveText("Koi");
    await visit("ready room", page);
    // Rooms open on Survival, which ends as soon as the idle racers fall out:
    // a slow sweep of the race screen found the results instead. A 20-floor
    // race stays up until the room is driven to its end.
    await chooseMode(page, "floors-20");

    // The select screen, the stage's reveal and the song step are each visited
    // for as long as the visit takes: the room is asked to hold the step's
    // clock, and the visit is of the screen it names, however slow the machine
    // is to measure it. The pick steps run 15 s and the reveal 4.5 s, and a
    // layout sweep that takes longer than that on a loaded PC was measuring the
    // next screen, or finding the one it came for gone. Held before Ready, the
    // stage step opens held; the room still ticks, so every page is kept up to
    // date, and Lock in still ends a held step the moment everyone has pressed it.
    await holdClocks(page, ["stage", "stageReveal", "song"]);
    await readyOnly([page, ...others]);
    await expect(page.getByTestId("select-screen")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
    await visit("select", page);
    // Everyone locks in once: the roulette runs, and is visited as it lands.
    for (const client of [page, ...others]) await pressLockIn(client);
    await expect(page.getByTestId("roulette"), "the reveal opens once everyone locks in").toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
    await expect(page.getByTestId("roulette-byline"), "the roulette lands").toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
    await visit("reveal", page);
    // The reveal is let go, and runs out its own ticks into the song step,
    // which opens held and is visited the same way.
    await holdClocks(page, ["song"]);
    await waitForRoom(code, (now) => now.step === "song", { what: "the song step opens after the stage reveal", ticks: REVEAL_TICKS + 30 });
    await expect(page.getByTestId("select-screen"), "the song step opens after the stage reveal").toHaveAttribute("data-step", "song", { timeout: CLIENT_FOLLOWS_MS });
    await expect(page.getByTestId("song-slide")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
    await visit("song", page);
    // Then everyone locks in and the race begins.
    await holdClocks(page, []);
    await passSelect([page, ...others]);
    await expectScreen(page, "gameplay");
    await expect(page.getByTestId("race-hud")).toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
    await visit("race", page);

    await driveRoom(code);
    await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
    await visit("results", page);
  } finally {
    for (const other of others) await other.context().close();
    await context.close();
  }
}
