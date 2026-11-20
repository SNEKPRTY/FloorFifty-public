/**
 * The Visual Overhaul #2 evidence batch (launch polish spec 2.6).
 *
 * The Aquarian matrix, re-shot into `evidence/overhaul-2/`, plus
 * the four course phrases laid out two by two like the extended-stage board,
 * so the user can hold them side by side with it at the phase 1 gate. Cloned
 * from `aquarian-evidence.spec.ts`; the two batches stay separate so the
 * accepted Aquarian record keeps its own pictures.
 *
 * These tests assert almost nothing about how the result looks, and that is
 * deliberate. What they assert is that each capture is of a real screen with
 * real pixels in it, because the failure they guard against is a batch of
 * rectangles the reviewer then studies for an hour. Whether the picture is
 * *right* is the human gate's question and is recorded in
 * `docs/art/overhaul-2-review.md`.
 *
 * Nothing here fabricates a floor count or a winner. The course phrases are
 * reached by driving valid inputs into the same simulation a keypress reaches
 * and reading back what authority says the racer's progress is -- see
 * `apps/server/src/rooms/room-driver.ts`, which has no code path that writes a
 * position, a standing or a winner.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { isBlank } from "./support/pixels";
import { expect, test, type Browser, type Page } from "./support/test";
import { driveRoom, waitForServer } from "./support/server-fixture";
import { evidenceDir } from "./support/evidence";
import {
  chooseMode,
  createRoom,
  expectCanvasHasPixels,
  expectVeilGone,
  expectScreen,
  joinRoom,
  openClient,
  openClients,
  readyAll,
  RESULTS_TIMEOUT_MS,
} from "./support/room-driver";

const SHOTS = evidenceDir("overhaul-2");

/** Guest names, distinct and unnumbered, so a truncated roster is legible. */
const GUESTS = ["Sable", "Wren", "Koi"];

/**
 * The console's phrases, as the floor band a capture should land inside.
 *
 * `content/stages/rooftops.toml` authors these as floors over a twenty-floor
 * course. Read off the content rather than guessed: a capture labelled with a
 * phrase it is not showing is evidence for nothing.
 */
const PHRASES: readonly (readonly [string, number, number])[] = [
  ["teach", 1, 5],
  ["combine", 6, 11],
  ["recover", 12, 15],
  ["finish", 16, 19],
];

test.beforeAll(async () => {
  await waitForServer();
  await mkdir(SHOTS, { recursive: true });
});

/**
 * The floor the HUD is currently showing, or `undefined` before the first
 * snapshot.
 *
 * Read from the screen rather than from the server's drive report, because the
 * two are not the same instant: the room keeps simulating in real time between
 * a drive call and a capture, so a driver-side number can be several floors
 * stale by the time the shutter opens. The HUD is what the capture is a picture
 * of, so it is what decides when to take one.
 */
async function shownFloor(page: Page): Promise<number | undefined> {
  const text = await page
    .getByTestId("hud-floors")
    .textContent()
    .catch(() => null);
  const digits = /\d+/.exec(text ?? "");
  return digits === null ? undefined : Number(digits[0]);
}

/**
 * Drives until the HUD shows a floor inside `[low, high]`, then captures.
 *
 * Small chunks, polled between each, because the band is four or five floors
 * wide and a single long drive would step straight over it. It fails rather
 * than capturing out of band: an evidence still filed under `finish` that shows
 * the recover phrase is worse than a missing one.
 */
async function capturePhrase(
  page: Page,
  code: string,
  phrase: string,
  low: number,
  high: number,
): Promise<void> {
  for (let step = 0; step < 600; step += 1) {
    const shown = await shownFloor(page);
    if (shown !== undefined) {
      if (shown > high) {
        throw new Error(`the ${phrase} band (${low}-${high}) was passed; the HUD shows ${shown}`);
      }
      if (shown >= low) {
        // The shutter first and the checks after: the room keeps simulating in
        // real time, and every millisecond between the read and the shot is
        // climb the capture might show instead of this phrase.
        const shot = await page.screenshot();
        const after = await shownFloor(page);
        if (after !== undefined && after > high) continue;
        expect(isBlank(shot), `the ${phrase} capture is blank`).toBe(false);
        await writeFile(`${SHOTS}/desktop-phrase-${phrase}.png`, shot);
        return;
      }
    }
    // Small steps, and smaller near the band: the driver steps the room
    // synchronously, and twenty ticks can take four floors -- a whole band.
    const near = shown !== undefined && shown >= low - 4;
    const result = await driveRoom(code, { ticks: near ? 4 : 20 });
    // The countdown happens on the stage now (race-flow spec §3), so the first
    // drives can land in it; only a finished race is past the band.
    if (result.phase !== "racing" && result.phase !== "countdown") {
      throw new Error(`the race finished before the ${phrase} band`);
    }
  }
  throw new Error(`never reached the ${phrase} band`);
}

/**
 * Lays the four phrase captures out two by two, in reading order, as the
 * extended-stage board lays out its four panels: lower rooftops, middle
 * skyline, above the rooftops, open-sky finish. Written beside the four
 * originals as `desktop-phrases-board.png`, at half size per panel.
 */
async function composeBoard(files: readonly string[]): Promise<void> {
  const panels = await Promise.all(files.map(async (file) => PNG.sync.read(await readFile(file))));
  const width = Math.floor(panels[0]!.width / 2);
  const height = Math.floor(panels[0]!.height / 2);
  const gap = 8;
  const board = new PNG({ width: width * 2 + gap * 3, height: height * 2 + gap * 3 });
  board.data.fill(255);
  panels.forEach((panel, index) => {
    const left = gap + (index % 2) * (width + gap);
    const top = gap + Math.floor(index / 2) * (height + gap);
    // A 2 x 2 box average, so the half-size panel is a fair reduction.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const out = ((top + y) * board.width + left + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          let sum = 0;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            sum += panel.data[((y * 2 + dy) * panel.width + x * 2 + dx) * 4 + channel] ?? 0;
          }
          board.data[out + channel] = Math.round(sum / 4);
        }
      }
    }
  });
  await writeFile(`${SHOTS}/desktop-phrases-board.png`, PNG.sync.write(board));
}

/**
 * Captures the whole page, failing if the canvas drew nothing. A liquid edge
 * covers the screen while it swaps (race-flow spec §7.3), so a capture waits
 * for it to reveal: a covered canvas is a picture of the veil, not a canvas
 * that drew nothing.
 */
async function capture(page: Page, name: string): Promise<void> {
  await expectVeilGone(page, `the veil has revealed ${name}`);
  await expectCanvasHasPixels(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test("captures the four screens at this viewport", async ({ browser }, testInfo) => {
  test.slow();
  const viewport = testInfo.project.name;
  // Four players, because that is where the questions this evidence exists to
  // answer actually arise: whether a racer is findable during overlap, and
  // whether four roster rows and four seat colours still read.
  const clients = await openClients(browser, 4);
  const host = clients[0]!;

  try {
    await capture(host, `${viewport}-menu`);

    const code = await createRoom(host, "Kite");
    for (const [index, guest] of clients.slice(1).entries()) {
      await joinRoom(guest, code, GUESTS[index]!);
    }
    await capture(host, `${viewport}-ready-room`);

    await readyAll(clients);
    await expectScreen(host, "gameplay", 30_000);
    // Off the first frame of the course, so the shot shows the climb.
    await host.waitForTimeout(4000);
    await capture(host, `${viewport}-race`);

    await driveRoom(code);
    await expectScreen(host, "game-end", RESULTS_TIMEOUT_MS);
    await capture(host, `${viewport}-results`);
  } finally {
    for (const page of clients) await page.context().close().catch(() => undefined);
  }
});

test("captures the four course phrases", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one phrase set, on the largest viewport");
  test.slow();

  // One race per phrase, and up to five tries each. The driver's last steer stays
  // held while the room runs on in real time between drive calls, so a racer
  // can climb straight through a four-floor band; a fresh race from the start
  // line is a fair second attempt, where carrying on up the tower is not.
  for (const [phrase, low, high] of PHRASES) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [host] = await openClients(browser, 1);
      try {
        const code = await createRoom(host!, "Kite");
        // Rooms open on Survival (catalog order, 2026-10-13); this climbs the 20-floor race.
        await chooseMode(host!, "floors-20");
        await readyAll([host!]);
        await expectScreen(host!, "gameplay", 30_000);
        await capturePhrase(host!, code, phrase, low, high);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      } finally {
        await host!.context().close().catch(() => undefined);
      }
    }
    if (lastError !== undefined) throw lastError;
  }
  await composeBoard(PHRASES.map(([phrase]) => `${SHOTS}/desktop-phrase-${phrase}.png`));
});

test("captures the fallback and validation presentations", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one fallback set, on the largest viewport");
  test.slow();

  // The validation error is a real refusal from the real server: the client is
  // told what a room code is and says so.
  const [host] = await openClients(browser, 1);
  try {
    await host!.getByTestId("name-input").fill("Kite");
    await host!.getByTestId("code-input").fill("BAD");
    await host!.getByTestId("join-room").click();
    await expect(host!.getByTestId("menu-status")).not.toBeEmpty();
    await capture(host!, "desktop-menu-error");
  } finally {
    await host!.context().close().catch(() => undefined);
  }

  // The low-quality menu. This is the one quality step the client can express:
  // the level is a compile-time constant chosen by the frame-budget gate, and
  // there is no runtime setting yet -- see `QUALITY_LEVEL`.
  const lowContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const low = await lowContext.newPage();
  try {
    await openClient(low, "/?refraction=low");
    await capture(low, "desktop-menu-low-quality");
  } finally {
    await lowContext.close().catch(() => undefined);
  }

  // Reduced-motion gameplay: the comfort boundary, captured rather than
  // described, because "still, but still a picture" is a judgement.
  const quietContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "reduce",
  });
  const quiet = await quietContext.newPage();
  try {
    await openClient(quiet, "/");
    const code = await createRoom(quiet, "Kite");
    await readyAll([quiet]);
    await expectScreen(quiet, "gameplay", 30_000);
    // A few floors up, so the capture shows a climb rather than the start line.
    // The racers keep moving under reduced motion; it is the optics that hold.
    await driveRoom(code, { ticks: 60 * 80 });
    await quiet.waitForTimeout(1200);
    await capture(quiet, "desktop-gameplay-reduced-motion");
  } finally {
    await quietContext.close().catch(() => undefined);
  }
});

/**
 * Records one traversal and files it under `name`.
 *
 * A lap race, so the climb, the reset to the bottom of the course and the
 * finish all occur inside one short run. The driver supplies real inputs; a
 * three-lap race is set through the room's own control, which is the same
 * button a host presses.
 */
async function recordTraversal(
  browser: Browser,
  name: string,
  reducedMotion: "reduce" | "no-preference",
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion,
    recordVideo: { dir: SHOTS, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    await openClient(page, "/");
    const code = await createRoom(page, "Kite");
    // Rooms open on Survival (catalog order, 2026-10-13); this climbs the 20-floor race.
    await chooseMode(page, "floors-20");
    await page.getByTestId("lap-3").click();
    await readyAll([page]);
    await expectScreen(page, "gameplay", 30_000);
    // Let the countdown and the entrance settle so the recording opens on the
    // climb rather than on the transition into it.
    await page.waitForTimeout(1500);
    await driveRoom(code, { ticks: 60 * 60 * 5 });
    await page.waitForTimeout(1500);
    await expectCanvasHasPixels(page);
  } finally {
    await context.close().catch(() => undefined);
    const recorded = video === null ? undefined : await video.path().catch(() => undefined);
    // Playwright names the file itself. Filed under a name a reviewer can find.
    if (recorded !== undefined) await rename(recorded, `${SHOTS}/${name}.webm`);
  }
}

test("records a normal-motion traversal", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one traversal set, on the largest viewport");
  test.slow();
  await recordTraversal(browser, "desktop-traversal", "no-preference");
});

test("records a reduced-motion traversal", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one traversal set, on the largest viewport");
  test.slow();
  await recordTraversal(browser, "desktop-traversal-reduced-motion", "reduce");
});

test("records the menu's parallax and drifting clouds", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one menu recording, on the largest viewport");
  // Spec §2.9: the menu's layers slide against each other with a slow sway
  // and lean toward the pointer, and the clouds drift at their own speeds. A
  // still cannot show either, so the evidence is a short recording with a
  // pointer sweep across it.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "no-preference",
    recordVideo: { dir: SHOTS, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const video = page.video();
  try {
    await openClient(page, "/");
    await page.waitForTimeout(800);
    for (let step = 0; step <= 40; step += 1) {
      await page.mouse.move(80 + step * 28, 360 + Math.sin(step / 6) * 120);
      await page.waitForTimeout(100);
    }
    await expectCanvasHasPixels(page);
  } finally {
    await context.close().catch(() => undefined);
    const recorded = video === null ? undefined : await video.path().catch(() => undefined);
    if (recorded !== undefined) await rename(recorded, `${SHOTS}/desktop-menu-parallax.webm`);
  }
});
