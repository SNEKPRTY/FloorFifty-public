import { expect, test, type Page } from "./support/test";
import type { LocaleTag } from "../../apps/client/src/features/i18n/locales";
import { SETTINGS_KEY } from "../../apps/client/src/features/profile/settings";
import { forceSetPiece, liveWords, peakParticlesDuring, stressJuice } from "./support/inspection";
import { driveRoom, waitForServer } from "./support/server-fixture";
import {
  chooseMode,
  createRoom,
  expectScreen,
  finishRace,
  joinRoom,
  openClients,
  openTitle,
  passSelect,
  pickStage,
  readyOnly,
} from "./support/room-driver";

// Owner-approved regression limits (2026-10-12): allow runner cadence variance
// without treating these CI checks as a 60 fps acceptance gate.
const GAMEPLAY_P95_MS = 50;
const WIPE_P95_MS = 66.7;

test.beforeAll(async () => {
  await waitForServer();
});

/**
 * The animated menu refraction and the gameplay filter chain, measured in the
 * same browser run so both workloads are held to the same presentation budget.
 *
 * The menu sample covers the new scene-level dawn refraction. The gameplay
 * sample covers the existing race chain after refraction has been removed;
 * the LCD panel is a device-resolution pass on top of it that this initiative
 * does not bound.
 *
 * **This budget probe runs headed.** The legacy headless shell fell back to
 * rasterising WebGL through SwiftShader, which cannot draw a multi-pass filter
 * chain at 1280x720 in real time: headless reports a median around 480ms and a
 * p95 near 900ms for a chain that renders at a steady 16.7ms on the same
 * machine with a GPU. That is not a slow shader and not a throttled page -- it
 * is software rendering, and no amount of foregrounding or anti-throttling
 * flags changes it. `--disable-renderer-backgrounding` and friends were tried
 * and moved the number by nothing.
 *
 * Two caveats still travel with the number. `requestAnimationFrame` deltas
 * measure presentation cadence rather than GPU cost, so a run that clears the
 * budget has shown the chain keeps up with the display, not how much headroom
 * is left. And the measurement includes the panel, which is not on the degrade
 * ladder, so a project that misses the budget should be re-run with
 * `?lcd=grid:0` before the quality level is stepped down, or the wrong pass
 * gets blamed.
 */

// Functional suites use full Chromium with a GPU in new headless mode. This
// timing probe explicitly stays headed; the median guard rejects software
// rendering if the runner loses its GPU.
test.use({ headless: false, reducedMotion: "no-preference" });

async function framePacing(page: Page): Promise<{ median: number; p95: number }> {
  const frames = await page.evaluate(async () => {
    const samples: number[] = [];
    let previous = performance.now();
    await new Promise<void>((resolve) => {
      let count = 0;
      const tick = (): void => {
        const now = performance.now();
        samples.push(now - previous);
        previous = now;
        count += 1;
        if (count < 120) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return samples;
  });

  const sorted = [...frames].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
  };
}

/** Every stage, since each draws its own layer list (stage ascent spec §7.3). */
const STAGES = ["rooftops", "snow-shrine", "sunken-dome"] as const;

/**
 * Measures the race on `stage` with two racers, both having picked it so the
 * reveal can land nowhere else. The menu is measured on the first stage's run
 * only: it does not change with the stage.
 */
async function measureStage(
  browser: import("@playwright/test").Browser,
  stage: (typeof STAGES)[number],
  quality: "high" | "low" | undefined,
  measureMenu: boolean,
  locale?: LocaleTag,
): Promise<void> {
  const settings =
    quality === undefined && locale === undefined
      ? undefined
      : { ...(quality === undefined ? {} : { display: { quality } }), ...(locale === undefined ? {} : { locale }) };
  const [host, guest] = (await openClients(browser, 2, settings)) as [
    import("@playwright/test").Page,
    import("@playwright/test").Page,
  ];
  const label = [stage, quality, locale].filter((part) => part !== undefined).join(",");
  try {
    await host.bringToFront();
    const menu = measureMenu ? await framePacing(host) : undefined;
    if (menu !== undefined) {
      console.log(
        `menu-refraction median ${menu.median.toFixed(2)}ms, p95 ${menu.p95.toFixed(2)}ms, ` +
          "over 120 frames",
      );
    }

    // Every race is recorded for Save and Share (unlockables spec §6.1), and
    // the budget is held with that recording on: counted here, so a run where
    // the recorder never started cannot pass as one where it did.
    await host.evaluate(() => {
      const counts = { started: 0, stopped: 0 };
      (window as unknown as { __ffRecorders: typeof counts }).__ffRecorders = counts;
      const { start, stop } = MediaRecorder.prototype;
      MediaRecorder.prototype.start = function (...args) {
        counts.started += 1;
        return start.apply(this, args);
      };
      MediaRecorder.prototype.stop = function () {
        counts.stopped += 1;
        return stop.apply(this);
      };
    });

    const code = await createRoom(host, "Kite");
    await joinRoom(guest, code, "Ninja 2");
    await readyOnly([host, guest]);
    for (const page of [host, guest]) {
      await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
      await pickStage(page, stage);
    }
    await passSelect([host, guest]);
    await expectScreen(host, "gameplay");

    // Off the ground, so the sample covers a drawn course rather than the
    // first frame of one.
    await host.waitForTimeout(4000);
    // Foreground immediately before each measurement. Chromium clamps hidden
    // requestAnimationFrame callbacks to roughly 1 Hz, which looks like a slow
    // shader and is only a throttled page.
    await host.bringToFront();
    const gameplay = await framePacing(host);
    const recorders = await host.evaluate(() => (window as unknown as { __ffRecorders: { started: number; stopped: number } }).__ffRecorders);
    expect(recorders.started - recorders.stopped, "the race was measured with its recording on").toBe(1);
    // Reported so the review record carries the measurement rather than a memory
    // of it, and so a throttled run is legible as one: a clamped page reports a
    // median as well as a p95 around 1000ms, while a genuinely slow chain has a
    // healthy median and a long tail.
    console.log(
      `gameplay-chain[${label}] median ${gameplay.median.toFixed(2)}ms, ` +
        `p95 ${gameplay.p95.toFixed(2)}ms, over 120 frames`,
    );

    // A median in the hundreds is a broken measurement rather than a failing
    // budget, and saying so here stops the next reader tuning a shader that was
    // never slow. In practice it means the run had no GPU.
    for (const sample of [menu, gameplay]) {
      if (sample === undefined) continue;
      expect(
        sample.median,
        "frame pacing looks software-rendered -- run this spec headed, on a machine with a GPU",
      ).toBeLessThan(100);
    }

    // The relaxed regression ceiling tolerates short runner stalls. It does
    // not certify 60 Hz presentation or trigger a renderer quality change.
    if (menu !== undefined) expect(menu.p95).toBeLessThan(GAMEPLAY_P95_MS);
    expect(gameplay.p95).toBeLessThan(GAMEPLAY_P95_MS);
  } finally {
    await host.context().close().catch(() => undefined);
    await guest.context().close().catch(() => undefined);
  }
}

for (const [index, stage] of STAGES.entries()) {
  test(`the filter chain holds a frame budget on ${stage}`, async ({ browser }) => {
    test.slow();
    await measureStage(browser, stage, undefined, index === 0);
  });

  test(`the low graphics setting holds a frame budget on ${stage}`, async ({ browser }) => {
    test.slow();
    await measureStage(browser, stage, "low", false);
  });
}

// The race in Japanese (languages spec §8.1): the CJK face and the longest
// glyph runs must not cost frames. Measured on the tablet, menu included,
// where the title and lobby draw the most Japanese text.
test("the race in Japanese holds the frame budget", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "frame-budget-tablet", "measured on the tablet project (languages spec §8.1)");
  test.slow();
  await measureStage(browser, "rooftops", undefined, true, "ja");
});

// The liquid wipe on its own (race-flow spec §9.1): sampled from the frame a
// liquid edge's veil appears (Title → Tutorial) through its 700 ms, on every
// frame-budget project, the tablet's included.
test("the liquid wipe holds the frame budget", async ({ browser }) => {
  test.slow();
  const page = await browser.newPage();
  try {
    await openTitle(page);
    await page.waitForTimeout(1_000);
    // Sampled from the frame the wipe appears, so idle frames before the click
    // are not counted: 42 frames is about its 700 ms at 60 Hz.
    const pacing = page.evaluate(
      () =>
        new Promise<{ median: number; p95: number }>((resolve) => {
          const deltas: number[] = [];
          let last = 0;
          const frame = (now: number) => {
            if (last !== 0) deltas.push(now - last);
            last = now;
            if (deltas.length < 42) requestAnimationFrame(frame);
            else {
              const sorted = [...deltas].sort((a, b) => a - b);
              resolve({ median: sorted[21]!, p95: sorted[Math.floor(sorted.length * 0.95)]! });
            }
          };
          const observer = new MutationObserver(() => {
            if (document.querySelector('[data-testid="transition-veil"]') === null) return;
            observer.disconnect();
            requestAnimationFrame(frame);
          });
          observer.observe(document.body, { childList: true });
        }),
    );
    await page.getByTestId("quick-story").click();
    const { median, p95 } = await pacing;
    console.log(`liquid-wipe median ${median.toFixed(2)}ms, p95 ${p95.toFixed(2)}ms, over 42 frames`);
    expect(median, "frame pacing looks software-rendered -- run this spec headed, on a machine with a GPU").toBeLessThan(100);
    expect(p95, "the brief wipe stays within its relaxed regression budget").toBeLessThan(WIPE_P95_MS);
  } finally {
    await page.context().close().catch(() => undefined);
  }
});

// Four racers slamming together (polish spec §10.1): the juice's worst case,
// every racer's deep squash and dust ring every 100 ms, measured on rooftops
// with the pool held at its limit (recycling its oldest), on every
// frame-budget project. The count is sampled every frame of the measurement.
//
// Only the host stays open for the measurement. The other three clients seat
// three more racers and are closed once the race is up. Each one left open is
// another WebGL page on this machine's one GPU (the runner's is an integrated
// Radeon), and the host's frames would then measure the machine sharing itself,
// not the juice: on the runner (2026-10-09) the calm host drew at a median of
// 17.7 ms alone, 22.5 with a second client open, 46.6 with a third and 63 with
// a fourth, and the same stress with the host alone drew at 17.9 (p95 about
// 21). A closed client's racer stands on as a ghost for the reconnect grace
// (30 s), still drawn and still slammed in a finite race; Survival's rising
// edge would eliminate idle racers before the measurement ends. The
// word-slot check below fails the case if a racer drops out of the host's view.
test("four racers slamming together hold the frame budget", async ({ browser }) => {
  test.slow();
  const pages = await openClients(browser, 4);
  const host = pages[0]!;
  try {
    const code = await createRoom(host, "Kite");
    await chooseMode(host, "floors-50");
    const names = ["Ninja 2", "Ninja 3", "Ninja 4"];
    for (const [index, page] of pages.slice(1).entries()) await joinRoom(page, code, names[index]!);
    await readyOnly(pages);
    for (const page of pages) {
      await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
      await pickStage(page, "rooftops");
    }
    await passSelect(pages);
    await expectScreen(host, "gameplay");
    // Off the ground, with the countdown behind it.
    await host.waitForTimeout(4000);
    // The guests leave a racing room, where a dropped seat stays a ghost; a
    // beat for the GPU to be the host's alone before the stress starts.
    for (const guest of pages.slice(1)) await guest.context().close();
    await host.waitForTimeout(2000);
    await host.bringToFront();

    await expectScreen(host, "gameplay");
    await stressJuice(host, true);
    // And the stage's busiest set piece on top: lightning and rain (Wonder spec §6.6).
    expect(await forceSetPiece(host, 45), "rooftops has a set piece at floor 45").toBe(true);
    // The words at their caps (Wonder spec §6.6): two of the local racer's, one per rival, and a beat.
    await expect.poll(() => liveWords(host), { timeout: 5_000, message: "the stress fills every word slot" }).toBeGreaterThanOrEqual(6);
    // A beat for the pool to fill before the sample starts.
    await host.waitForTimeout(1_000);
    let pacing!: Awaited<ReturnType<typeof framePacing>>;
    const peak = await peakParticlesDuring(host, async () => {
      pacing = await framePacing(host);
    });
    await expectScreen(host, "gameplay");
    expect(await liveWords(host), "every racer's stress workload remains present").toBeGreaterThanOrEqual(6);
    await stressJuice(host, false);

    console.log(
      `juice-stress median ${pacing.median.toFixed(2)}ms, p95 ${pacing.p95.toFixed(2)}ms, ` +
        `${peak} live particles, over 120 frames`,
    );
    expect(peak, "the pool reached its limit and never passed it").toBe(160);
    expect(pacing.median, "frame pacing looks software-rendered -- run this spec headed, on a machine with a GPU").toBeLessThan(100);
    expect(pacing.p95).toBeLessThan(GAMEPLAY_P95_MS);
  } finally {
    for (const page of pages) await page.context().close().catch(() => undefined);
  }
});

// A four-racer replay at 2× (race-options spec §10.1): the re-simulation steps
// two ticks a frame on top of the race's own drawing.
test("a four-racer replay at 2× holds the frame budget", async ({ browser }) => {
  test.slow();
  const { pages } = await finishRace(browser, { seats: 4 });
  const viewer = pages[0]!;
  try {
    await expect(viewer.getByTestId("watch-replay")).toBeEnabled({ timeout: 15_000 });
    await viewer.getByTestId("watch-replay").click();
    await expectScreen(viewer, "replay");
    // The other racers watch on their own devices. Left open here, their
    // three Results pages share this machine's GPU with the viewer, which the
    // gameplay chain (two pages) never measures. The viewer still re-simulates
    // all four racers.
    for (const page of pages.slice(1)) await page.context().close();
    await viewer.keyboard.press("s");
    await expect(viewer.getByTestId("replay-speed")).toHaveText("2×");
    await viewer.waitForTimeout(2000);
    await viewer.bringToFront();
    const replay = await framePacing(viewer);
    console.log(`replay-2x median ${replay.median.toFixed(2)}ms, p95 ${replay.p95.toFixed(2)}ms, over 120 frames`);
    expect(replay.median, "frame pacing looks software-rendered -- run this spec headed, on a machine with a GPU").toBeLessThan(100);
    expect(replay.p95).toBeLessThan(GAMEPLAY_P95_MS);
  } finally {
    for (const page of pages) await page.context().close().catch(() => undefined);
  }
});

/**
 * Turns the stage step's seed chip from Random to Classic: the stage's authored
 * climb, the same course every run. The step opens on a fresh course (stage
 * seeds spec §1), and the Survival case below is tuned on the authored one.
 * The chip shows the room's answer, so waiting for "classic" waits for the
 * room to take the pick.
 */
async function pickClassic(page: Page): Promise<void> {
  const chip = page.getByTestId("seed-chip");
  await expect(chip, "the stage step opens on a fresh course").toHaveAttribute("data-choice", "random");
  await chip.click();
  await expect(chip, "the pick is the authored course").toHaveAttribute("data-choice", "classic");
}

// Survival mid-climb (audit remediation D-R9, survival spec §6-7): a taller
// course, a moving window of bodies and sprites, the rising edge's camera and
// its vignette. Alone in the room: in Survival a second seat that left would
// go out under its edge and end the race as the last one standing, and the
// reference bot falls out about 30 floors up, so the frames are measured
// mid-climb, from around floor 19, while the edge is rising.
// Those numbers belong to Rooftops' authored climb. A fresh course (what the
// stage step opens on) can put the bot out before tick 1000 -- the one the e2e
// server draws for a first round does, by tick 640 -- so the case picks Classic.
// `tests/server/rooms/survival-frame-budget.test.ts` holds the same numbers on
// every push.
// The ramp's own cost is the simulation's, held by `server-perf/endless-cost`.
test("a Survival race mid-climb holds the frame budget", async ({ browser }) => {
  test.slow();
  const [host] = (await openClients(browser, 1)) as [Page];
  let climbing = false;
  let keepClimbing: Promise<void> = Promise.resolve();
  try {
    const code = await createRoom(host, "Kite");
    await chooseMode(host, "infinite");
    await readyOnly([host]);
    await expect(host.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
    await pickStage(host, "rooftops");
    await pickClassic(host);
    await passSelect([host]);
    await expectScreen(host, "gameplay");
    // In slices, so the browser's socket drains between them.
    await driveRoom(code, { ticks: 500 });
    const climbed = await driveRoom(code, { ticks: 500 });
    expect(climbed.phase, "the racer is still in when the frames are measured").toBe("racing");
    expect(Math.max(...climbed.progress.map((racer) => racer.progress)), "the racer climbed past floor 12").toBeGreaterThanOrEqual(12 / 49);
    // Keep them climbing while the frames are measured.
    climbing = true;
    keepClimbing = (async () => {
      while (climbing) {
        await driveRoom(code, { ticks: 3 });
        await host.waitForTimeout(50);
      }
    })();
    await host.waitForTimeout(1500);
    await host.bringToFront();
    const pacing = await framePacing(host);
    climbing = false;
    await keepClimbing;
    const after = await driveRoom(code, { ticks: 1 });
    expect(after.phase, "the racer was still in for every measured frame").toBe("racing");
    console.log(`survival-mid-climb median ${pacing.median.toFixed(2)}ms, p95 ${pacing.p95.toFixed(2)}ms, over 120 frames`);
    expect(pacing.median, "frame pacing looks software-rendered -- run this spec headed, on a machine with a GPU").toBeLessThan(100);
    expect(pacing.p95).toBeLessThan(GAMEPLAY_P95_MS);
  } finally {
    climbing = false;
    await keepClimbing.catch(() => undefined);
    await host.context().close().catch(() => undefined);
  }
});

// Story mode v2, criterion 25: the story's last chapter, Floor Fifty, with its three racers, the
// glims, the lamps' layer and the lava, measured from its first climb to its last, played on the keys
// by the story bot inside the page (an inspection build) in real time while the frames are measured.
test("the story's last chapter holds the frame budget from its first climb to its last", async ({ browser }) => {
  test.slow();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((key) => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...stored, version: 2, story: { chaptersDone: 4, chapters: {} } }));
    } catch {
      // Without storage the hub opens on chapter 1, and the selected check below fails.
    }
  }, SETTINGS_KEY);
  const page = await context.newPage();
  type Hook = { step: string | undefined; doneAtTick?: number; want: { left: boolean; right: boolean; fastFall: boolean } };
  let doneSeenAtMs: number | undefined;
  const keys = { left: "KeyA", right: "KeyD", fastFall: "KeyS" } as const;
  let playing = true;
  let play: Promise<void> = Promise.resolve();
  try {
    await openTitle(page);
    await page.getByTestId("quick-story").click();
    await expectScreen(page, "story");
    await expect(page.getByTestId("story-hub")).toHaveAttribute("data-selected", "4", { timeout: 30_000 });
    await page.getByTestId("story-play").click();
    await page.getByTestId("story-cutscene-skip").click({ timeout: 30_000 });
    await expect(page.getByTestId("story-line").or(page.getByTestId("story-chip")).first()).toBeVisible({ timeout: 30_000 });
    // The bot's advice pressed on the keys as fast as the page answers, until the results.
    play = (async () => {
      const held = new Set<keyof typeof keys>();
      while (playing) {
        const now = await page.evaluate(() => (window as unknown as { __ffStory?: () => Hook }).__ffStory?.());
        if (now === undefined || now.step === "results") break;
        if (now.doneAtTick !== undefined) doneSeenAtMs ??= Date.now();
        for (const name of Object.keys(keys) as (keyof typeof keys)[]) {
          if (now.want[name] && !held.has(name)) {
            held.add(name);
            await page.keyboard.down(keys[name]);
          } else if (!now.want[name] && held.has(name)) {
            held.delete(name);
            await page.keyboard.up(keys[name]);
          }
        }
      }
      for (const name of held) await page.keyboard.up(keys[name]);
    })();
    await page.bringToFront();
    const samples: { median: number; p95: number }[] = [];
    // Three windows of 120 frames: the first climb, the middle and the end, while the chapter lasts.
    for (let window = 0; window < 3; window += 1) {
      if ((await page.getByTestId("story-results").count()) > 0) break;
      const pacing = await framePacing(page);
      samples.push(pacing);
      console.log(`story-fifty window ${window + 1}: median ${pacing.median.toFixed(2)}ms, p95 ${pacing.p95.toFixed(2)}ms, over 120 frames`);
      await page.waitForTimeout(3000);
    }
    expect(samples.length, "at least one window was measured in the climb").toBeGreaterThan(0);
    await expect(page.getByTestId("story-results"), "the chapter was played to its results").toBeVisible({ timeout: 120_000 });
    // The top is the end: the results follow the goal within a breath, with no dead stand (review 2, R2).
    const standMs = Date.now() - (doneSeenAtMs ?? Date.now());
    console.log(`story-fifty: results ${standMs} ms after the goal (seen by polling)`);
    expect(standMs, "the results follow the goal at the top").toBeLessThan(3500);
    for (const pacing of samples) {
      expect(pacing.median, "frame pacing looks software-rendered -- run this spec headed, on a machine with a GPU").toBeLessThan(100);
      expect(pacing.p95).toBeLessThan(GAMEPLAY_P95_MS);
    }
  } finally {
    playing = false;
    await play.catch(() => undefined);
    await context.close().catch(() => undefined);
  }
});
