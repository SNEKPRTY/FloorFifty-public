import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "./support/test";
import { evidenceDir } from "./support/evidence";
import { forceSetPiece, stressJuice } from "./support/inspection";
import { installPerfProbe, measureFrames, tracePasses, type FrameMode, type FrameStats } from "./support/perf-probe";
import { createRoom, expectScreen, joinRoom, openClient, openTitle, passSelect, pickStage, readyOnly } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * What a frame costs, not how often one is presented (see `support/perf-probe.ts`).
 *
 * A measurement, not a gate: nothing here can fail on a number. Run on its own
 * project, alone, against `pnpm e2e:serve`:
 *
 *   FLOOR_FIFTY_E2E_REUSE=1 FLOOR_FIFTY_PERF_TAG=baseline \
 *     pnpm exec playwright test --project=perf-probe --workers=1
 *
 * Every scenario runs on a desktop (1280 x 720 at 1x) and on a phone stand-in
 * (390 x 844 at 3x, which the canvas caps at 2x), with the panel on and with
 * `?lcd=off`, and each race also under a 4x CPU throttle. Results land in
 * `evidence/perf-probe/<tag>/`, one JSON per test, and a line per sample in
 * the log. `FLOOR_FIFTY_PERF_AB=<origin>` instead compares this build with
 * one served at that origin, in turns in the same scene (`abSample`), e.g. a
 * main build under `vite preview --outDir <dir> --port 4533`.
 * `FLOOR_FIFTY_PERF_ONLY` narrows the run to tests whose title
 * contains any of its comma-separated parts, so a title with spaces needs no
 * quoting.
 */

test.use({ reducedMotion: "no-preference" });
test.describe.configure({ mode: "serial" });

const TAG = process.env["FLOOR_FIFTY_PERF_TAG"] ?? "latest";
const FRAMES = Number(process.env["FLOOR_FIFTY_PERF_FRAMES"] ?? 180);
const ONLY = process.env["FLOOR_FIFTY_PERF_ONLY"];
const TRACE_ONLY = process.env["FLOOR_FIFTY_PERF_TRACE_ONLY"] === "1";
/** Another build's origin (`http://127.0.0.1:4533`), for an interleaved comparison; see `abSample`. */
const AB = process.env["FLOOR_FIFTY_PERF_AB"];
const ROUNDS = Number(process.env["FLOOR_FIFTY_PERF_ROUNDS"] ?? 3);

const DEVICES: Record<string, BrowserContextOptions> = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const PANELS = { lcd: "/", "lcd-off": "/?lcd=off" } as const;
const STAGES = ["rooftops", "snow-shrine", "sunken-dome"] as const;

test.beforeAll(async () => {
  await waitForServer();
});

type Sample = { label: string; stats: FrameStats };

function line({ label, stats }: Sample): string {
  const f = (value: number | null, digits = 2) => (value === null ? "--" : value.toFixed(digits));
  return (
    `${label.padEnd(44)} cpu ${f(stats.cpuMedian)}/${f(stats.cpuP95)}ms  gpu ${f(stats.gpuMedian)}/${f(stats.gpuP95)}ms  ` +
    `draws ${stats.drawsMedian}  passes ${stats.passesMedian} (${f(stats.passMegapixelsMedian)}Mpx)  ` +
    `programs ${stats.programsMedian}  tex ${stats.textureUploadsMedian} (${f(stats.textureUploadKbMedian, 0)}KB)  ` +
    `buf ${f(stats.bufferUploadKbMedian, 0)}KB  heap ${f(stats.heapMb, 1)}MB  alloc ${f(stats.allocKbPerFrame, 1)}KB/f  gc ${stats.gcs ?? "--"}  ` +
    `canvas ${stats.canvas?.width}x${stats.canvas?.height}`
  );
}

function record(title: string, samples: Sample[]): void {
  const dir = resolve(evidenceDir("perf-probe"), TAG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${title.replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify(samples, null, 2));
}

/** Measures `page` in each mode, and once more under a 4x CPU throttle if asked. */
async function sample(page: Page, label: string, throttled: boolean): Promise<Sample[]> {
  const samples: Sample[] = [];
  await page.bringToFront();
  const passes = await tracePasses(page);
  console.log(
    `${label} passes:\n` +
      passes.passes
        .map(
          (pass, index) =>
            `  ${String(index).padStart(2)} ${pass.size.padEnd(10)} ${String(pass.draws).padStart(3)} draws  ` +
            `${pass.gpuMs === null ? "   --  " : `${pass.gpuMs.toFixed(3)}ms`}  ${pass.programs.join(" | ")}`,
        )
        .join("\n") +
      `\n  (${passes.matching} of ${passes.frames} frames matched; ` +
      `GPU total ${passes.passes.reduce((sum, pass) => sum + (pass.gpuMs ?? 0), 0).toFixed(2)}ms)`,
  );
  samples.push({ label: `${label} trace`, stats: { trace: passes } as unknown as FrameStats });
  if (TRACE_ONLY) return samples;
  for (const mode of ["cpu", "sync"] as FrameMode[]) {
    const stats = await measureFrames(page, mode, FRAMES);
    samples.push({ label: `${label} ${mode}`, stats });
    console.log(line(samples.at(-1)!));
  }
  if (throttled) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    try {
      const stats = await measureFrames(page, "cpu", FRAMES);
      samples.push({ label: `${label} cpu@4x`, stats });
      console.log(line(samples.at(-1)!));
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await cdp.detach();
    }
  }
  return samples;
}

async function client(
  browser: Browser,
  device: BrowserContextOptions,
  path: string,
  lobby = true,
  origin = "",
): Promise<Page> {
  const context = await browser.newContext(device);
  await installPerfProbe(context);
  const page = await context.newPage();
  if (lobby) await openClient(page, `${origin}${path}`);
  else await openTitle(page, `${origin}${path}`);
  return page;
}

/**
 * The guest is frozen once the race is up, so the GPU the host is measured on
 * is not also drawing a second race. A browser that will not freeze it leaves
 * it running, which only adds to every sample alike.
 */
async function freeze(page: Page, frozen: boolean): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setWebLifecycleState", { state: frozen ? "frozen" : "active" }).catch(() => undefined);
  await cdp.detach();
}

async function race(
  browser: Browser,
  device: BrowserContextOptions,
  path: string,
  stage: string,
  guestOrigin = "",
): Promise<[Page, Page]> {
  const host = await client(browser, device, path);
  const guest = await client(browser, device, path, true, guestOrigin);
  const code = await createRoom(host, "Kite");
  await joinRoom(guest, code, "Ninja 2");
  await readyOnly([host, guest]);
  for (const page of [host, guest]) {
    await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });
    await pickStage(page, stage);
  }
  await passSelect([host, guest]);
  await expectScreen(host, "gameplay");
  await freeze(guest, true);
  await host.waitForTimeout(4000);
  return [host, guest];
}

async function close(pages: Page[]): Promise<void> {
  for (const page of pages) await page.context().close().catch(() => undefined);
}

for (const [deviceName, device] of Object.entries(DEVICES)) {
  for (const [panelName, path] of Object.entries(PANELS)) {
    const prefix = `${deviceName} ${panelName}`;
    const wanted = (title: string) =>
      AB === undefined && (ONLY === undefined || ONLY.split(",").some((part) => title.includes(part)));

    const menuTitle = `${prefix} menu`;
    test(menuTitle, async ({ browser }) => {
      test.skip(!wanted(menuTitle));
      test.setTimeout(180_000);
      // The title, with its parallax, refraction and bloom.
      const page = await client(browser, device, path, false);
      try {
        await page.waitForTimeout(1500);
        record(menuTitle, await sample(page, menuTitle, true));
      } finally {
        await close([page]);
      }
    });

    for (const stage of STAGES) {
      const raceTitle = `${prefix} race ${stage}`;
      test(raceTitle, async ({ browser }) => {
        test.skip(!wanted(raceTitle));
        test.setTimeout(240_000);
        const pages = await race(browser, device, path, stage);
        try {
          record(raceTitle, await sample(pages[0], raceTitle, true));
        } finally {
          await freeze(pages[1], false);
          await close(pages);
        }
      });
    }

    const juiceTitle = `${prefix} juice-stress rooftops`;
    test(juiceTitle, async ({ browser }) => {
      test.skip(!wanted(juiceTitle));
      test.setTimeout(240_000);
      const pages = await race(browser, device, path, "rooftops");
      try {
        // Every racer slamming every 100 ms, with the stage's busiest set piece on top.
        await stressJuice(pages[0], true);
        expect(await forceSetPiece(pages[0], 45), "rooftops has a set piece at floor 45").toBe(true);
        await pages[0].waitForTimeout(1500);
        record(juiceTitle, await sample(pages[0], juiceTitle, true));
        await stressJuice(pages[0], false);
      } finally {
        await freeze(pages[1], false);
        await close(pages);
      }
    });
  }
}

/**
 * Two builds in one scene, measured in turns.
 *
 * On a machine with other work on its GPU, two runs minutes apart differ by
 * more than a change is worth. So the comparison shares the moment instead:
 * one page from each build, in the same room or on the same title, the one not
 * being measured frozen, and the turns alternated over `ROUNDS` rounds. Each
 * figure is the median over the rounds of that build's per-round medians.
 */
async function abSample(pages: { build: string; page: Page }[], label: string): Promise<Sample[]> {
  const runs = new Map<string, FrameStats[]>();
  const keep = (key: string, stats: FrameStats) => runs.set(key, [...(runs.get(key) ?? []), stats]);
  for (let round = 0; round < ROUNDS; round += 1) {
    const order = round % 2 === 0 ? pages : [...pages].reverse();
    for (const { build, page } of order) {
      for (const other of pages) if (other.page !== page) await freeze(other.page, true);
      await freeze(page, false);
      await page.bringToFront();
      await page.waitForTimeout(600);
      for (const mode of ["cpu", "sync"] as FrameMode[]) keep(`${build} ${mode}`, await measureFrames(page, mode, FRAMES));
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      try {
        keep(`${build} cpu@4x`, await measureFrames(page, "cpu", FRAMES));
      } finally {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await cdp.detach();
      }
    }
  }
  for (const { page } of pages) await freeze(page, false);
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const samples: Sample[] = [];
  for (const [key, list] of runs) {
    const merged = { ...list[0]! } as Record<string, unknown>;
    for (const field of Object.keys(merged)) {
      const values = list.map((stats) => (stats as unknown as Record<string, unknown>)[field]);
      if (values.every((value) => typeof value === "number")) merged[field] = median(values as number[]);
    }
    samples.push({ label: `${label} ${key}`, stats: merged as unknown as FrameStats });
    console.log(line(samples.at(-1)!));
  }
  return samples;
}

const abWanted = (title: string) => AB !== undefined && (ONLY === undefined || ONLY.split(",").some((part) => title.includes(part)));

for (const [deviceName, device] of Object.entries(DEVICES)) {
  const prefix = `ab ${deviceName} lcd`;

  const menuTitle = `${prefix} menu`;
  test(menuTitle, async ({ browser }) => {
    test.skip(!abWanted(menuTitle));
    test.setTimeout(600_000);
    const current = await client(browser, device, "/", false);
    const base = await client(browser, device, "/", false, AB);
    try {
      await current.waitForTimeout(1500);
      record(menuTitle, await abSample([{ build: "this", page: current }, { build: "base", page: base }], menuTitle));
    } finally {
      await close([current, base]);
    }
  });

  for (const stage of STAGES) {
    const raceTitle = `${prefix} race ${stage}`;
    test(raceTitle, async ({ browser }) => {
      test.skip(!abWanted(raceTitle));
      test.setTimeout(900_000);
      const [current, base] = await race(browser, device, "/", stage, AB);
      try {
        record(raceTitle, await abSample([{ build: "this", page: current }, { build: "base", page: base }], raceTitle));
      } finally {
        await close([current, base]);
      }
    });
  }

  const juiceTitle = `${prefix} juice-stress rooftops`;
  test(juiceTitle, async ({ browser }) => {
    test.skip(!abWanted(juiceTitle));
    test.setTimeout(900_000);
    const [current, base] = await race(browser, device, "/", "rooftops", AB);
    try {
      await freeze(base, false);
      for (const page of [current, base]) await stressJuice(page, true);
      // On both pages: a set piece adds weather and sky particles, and a
      // comparison with it on one side only measures the weather.
      for (const page of [current, base]) {
        expect(await forceSetPiece(page, 45), "rooftops has a set piece at floor 45").toBe(true);
      }
      await current.waitForTimeout(1500);
      record(juiceTitle, await abSample([{ build: "this", page: current }, { build: "base", page: base }], juiceTitle));
    } finally {
      await close([current, base]);
    }
  });
}
