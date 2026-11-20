/**
 * A race driven from a room to Results, and the leak counters read once they
 * settle: shared by `race-flow.spec.ts` and `polish.spec.ts`.
 */

import { expect, type Browser, type Page } from "@playwright/test";
import { readCounters, type LeakCounters } from "./inspection";
import { COUNTDOWN_TICKS } from "../../../packages/shared/src/common/constants";
import {
  CLIENT_FOLLOWS_MS,
  RESULTS_TIMEOUT_MS,
  createRoom,
  expectScreen,
  holdClocks,
  joinRoom,
  openClients,
  passSelect,
  readyOnly,
} from "./room-driver";
import { driveRoom, waitForRoom } from "./server-fixture";

/**
 * `count` clients race from a room to Results, or the `opened` pages if they
 * are given (a test that reads a baseline on the title first). Returns the
 * pages, and how long after the finish the wipe to Results first appeared on
 * the first one.
 */
export async function raceToResults(
  browser: Browser,
  count = 2,
  opened?: Page[],
): Promise<{ pages: Page[]; heldMs: number }> {
  const pages = opened ?? (await openClients(browser, count));
  const code = await createRoom(pages[0]!, "Alpha");
  const names = ["Bravo", "Charlie", "Delta"];
  for (const [index, page] of pages.slice(1).entries()) await joinRoom(page, code, names[index]!);
  // The count is three seconds of the room's clock, from the tick the room
  // starts it, whether or not a page has its stage up yet; a page that takes
  // longer than that to build the stage (four of them compiling the same
  // shaders at once) comes up after GO, and there is no count left to see.
  // Held where it begins, the count stands at its first number on every page
  // for as long as the slowest takes, and runs when they have all shown it.
  await holdClocks(pages[0]!, ["countdown"]);
  await readyOnly(pages);
  await passSelect(pages);

  // The countdown happens on the stage (race-flow spec §3). Every page at once:
  // one after another, the fourth waited out the first three's stages.
  await Promise.all(
    pages.map(async (page) => {
      await expectScreen(page, "gameplay");
      await expect(page.getByTestId("race-count"), "the count shows over the stage").toBeVisible({ timeout: CLIENT_FOLLOWS_MS });
    }),
  );
  await holdClocks(pages[0]!, []);
  await waitForRoom(code, (now) => now.phase === "racing", { what: "the count runs out into the race", ticks: COUNTDOWN_TICKS + 60 });
  await expect(pages[0]!.getByTestId("race-count"), "GO clears").toBeHidden({ timeout: CLIENT_FOLLOWS_MS });

  // The finish and the wipe to Results, both stamped in the page: the hold is
  // the time from one to the other, before the cover and reveal are counted.
  // The finish is the HUD's "finished first", said from the snapshot that
  // starts the finish sequence. Stamped here rather than when `driveRoom`
  // returns, which on a loaded machine heard of the finish late and shortened
  // the hold it measured.
  //
  // The app measures the hold on the frames it has drawn: the sequence starts
  // at the last frame before the finish snapshot, and ends on the first frame
  // that is a hold later (`FinishSequence`, `Gameplay.draw`). So the hold runs
  // from that frame, up to a frame before the HUD says anything, and on a page
  // drawing eight frames a second that frame is 125 ms back: the nightly's
  // "reduced motion keeps the 1.2 s hold" measured 1 081 from the announcement
  // for a hold that was 1 200 from its own start. The hold is therefore
  // measured from the frame before the last one seen when the HUD spoke: never
  // later than the sequence's own start, and at most a frame before it, so a
  // hold that is short fails it as before and one a frame longer than it looks
  // does not.
  await pages[0]!.evaluate(() => {
    const seen = window as unknown as { __ffFinishFrameAt?: number; __ffVeilAt?: number };
    let last = performance.now();
    let previous = last;
    let sampling = true;
    const frame = (now: number): void => {
      if (!sampling) return;
      previous = last;
      last = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const observer = new MutationObserver(() => {
      const said = document.querySelector('[data-testid="race-announcer"]')?.textContent ?? "";
      if (seen.__ffFinishFrameAt === undefined && said.includes("finished first")) seen.__ffFinishFrameAt = previous;
      if (seen.__ffVeilAt === undefined && document.querySelector('[data-testid="transition-veil"]') !== null) {
        seen.__ffVeilAt = performance.now();
        // Both stamps are taken: the page is left as it was found, with no frame loop of ours in it.
        sampling = false;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const outcome = await driveRoom(code);
  expect(outcome.phase).toBe("finished");
  for (const page of pages) await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
  const { finishAt, veilAt } = await pages[0]!.evaluate(() => {
    const seen = window as unknown as { __ffFinishFrameAt?: number; __ffVeilAt?: number };
    return { finishAt: seen.__ffFinishFrameAt, veilAt: seen.__ffVeilAt };
  });
  expect(finishAt, "the HUD said who finished first").toBeDefined();
  expect(veilAt, "the wipe to Results appeared").toBeDefined();
  return { pages, heldMs: veilAt! - finishAt! };
}

/**
 * The counters once two readings 750 ms apart agree and no cue is sounding: a
 * title still arriving reads high. The first arrival at the title slams and
 * calls the game's name, and a title come back to from a race makes no call, so
 * a baseline read while they sound would never be reached again.
 */
export async function settledCounters(page: Page): Promise<LeakCounters> {
  let before = await readCounters(page);
  let agreeing = 0;
  await expect
    .poll(
      async () => {
        const now = await readCounters(page);
        agreeing =
          now.audioSources === before.audioSources &&
          now.displayObjects === before.displayObjects &&
          now.worldObjects === before.worldObjects
            ? agreeing + 1
            : 0;
        before = now;
        return agreeing >= 2 && now.cues === 0;
      },
      { intervals: [750], timeout: 15_000 },
    )
    .toBe(true);
  return before;
}
