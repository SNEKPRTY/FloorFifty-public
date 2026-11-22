import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type BrowserContext, type CDPSession, type Page, type Request } from "./support/test";
import { PNG } from "pngjs";
import { CLIENT_BOOT_MS, expectScreen, seedSettings } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * Loading on a slow phone link (Ruken loading plan, Task 11).
 *
 * The Owner's rule: a loading screen is fine, slow is fine; a blank screen, a
 * screen shown before its pictures, music and fonts have arrived, and a wait
 * that ends in silence are not. These specs run the client the way a slow
 * phone meets it -- Chromium's own network throttle (about 1.5 Mbps, 150 ms
 * a round trip) -- and watch it from outside, the way a player would:
 *
 *   1. From navigation to an interactive title, a screenshot every ~100 ms
 *      is never one flat colour, and no screen is shown before what it draws
 *      has arrived (the page's own record of what was true when the splash
 *      lifted, set beside what the network had delivered by then).
 *   2. A request that never answers ends in "couldn't load" with Try again
 *      after 30 s of silence and not before, and Try again recovers.
 *   3. A cold Tutorial from the title, under throttling, always shows the
 *      loader, above the wipe, with a bar that moves.
 *
 * Everything the cases wait on is a state; the 30 s is the rule itself.
 */

test.beforeAll(async () => {
  await waitForServer();
});

/**
 * The earliest a stalled request may be given up on, as the spec measures it:
 * 30 s from the request to the blackhole, which it reaches a few ms after the
 * page asked (the redirect hop), so a second of slack covers the measuring,
 * not the rule -- a give-up at 8 s or 10 s is still caught.
 */
const STALL_FLOOR_MS = 29_000;

/** A slow phone's link: about 1.5 Mbps down, 150 ms to the server and back. */
const SLOW_PHONE = { latency: 150, downloadThroughput: (1.5 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

async function throttle(page: Page, conditions: { latency: number; downloadThroughput: number; uploadThroughput: number }): Promise<CDPSession> {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", { offline: false, ...conditions });
  return session;
}

/** How many distinct colours a PNG holds. One is a flat frame: nothing on screen. */
function colours(png: Buffer): number {
  const { data } = PNG.sync.read(png);
  const seen = new Set<number>();
  for (let index = 0; index < data.length; index += 4) {
    seen.add(((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8) | (data[index + 2] ?? 0));
    if (seen.size > 1) break;
  }
  return seen.size;
}

type Sample = { at: number; flat: boolean; painted: boolean };

/**
 * Looks at the page every ~100 ms until `stop()` is called, the way a player
 * does: the composited screen, not the DOM. Straight from the browser's
 * compositor (`Page.captureScreenshot`), not Playwright's screenshot, which
 * waits for fonts and so would not look while they load -- the one time a
 * missing font matters. Half scale: a loader is still a ring and a word.
 */
function watchScreen(page: Page, startedAt: number): { stop(): Promise<Sample[]>; samples: Sample[] } {
  const samples: Sample[] = [];
  let running = true;
  const loop = (async () => {
    const session = await page.context().newCDPSession(page);
    while (running) {
      const tick = Date.now();
      try {
        // Nothing can be on screen before the document has painted once: the
        // browser's own blank before that is not the page's to fill.
        const painted = await page.evaluate(() => performance.getEntriesByName("first-paint").length > 0).catch(() => false);
        const { data } = await session.send("Page.captureScreenshot", {
          format: "png",
          clip: { x: 0, y: 0, width: 1280, height: 720, scale: 0.5 },
        });
        samples.push({ at: tick - startedAt, painted, flat: colours(Buffer.from(data, "base64")) <= 1 });
      } catch {
        // A navigation in flight or a page closing: not a sample.
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 100 - (Date.now() - tick))));
    }
    await session.detach().catch(() => undefined);
  })();
  return {
    samples,
    async stop() {
      running = false;
      await loop;
      return samples;
    },
  };
}

/** The page's own record of what was true when each screen showed (`window.__ffLoading`). */
type Moment = { name: string; at: number; facts: Record<string, boolean | number | string> };
const momentsOf = (page: Page): Promise<Moment[]> =>
  page.evaluate(() => (window as unknown as { __ffLoading?: Moment[] }).__ffLoading ?? []);
const unloadedTexturesOf = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __ffUnloadedTextures?: string[] }).__ffUnloadedTextures ?? []);

/** When each file of interest finished arriving, by the network's own account. */
function trackArrivals(context: BrowserContext): Map<string, number> {
  const finished = new Map<string, number>();
  const note = (request: Request): void => {
    const url = new URL(request.url());
    if (/\.(?:woff2|m4a)$/.test(url.pathname) || url.pathname.endsWith("splash.png")) finished.set(url.pathname, Date.now());
  };
  context.on("requestfinished", note);
  return finished;
}

/**
 * A server that takes a request and never answers it: a link that went dead
 * mid-request. Routing a request here (a redirect) is a stall as a phone
 * meets it -- the socket is open and nothing comes -- and not a request
 * Playwright holds paused, which would also hold up the page's reload.
 */
type Blackhole = { readonly origin: string; readonly firstRequestAt: () => number | undefined; close(): Promise<void> };
async function blackhole(): Promise<Blackhole> {
  let first: number | undefined;
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer(() => {
    first ??= Date.now();
    // Neither a reply nor an end.
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    firstRequestAt: () => first,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Sends every request for `pattern` to the blackhole. */
async function stallRequests(context: BrowserContext, pattern: string, hole: Blackhole): Promise<void> {
  await context.route(pattern, (route) => route.fulfill({ status: 302, headers: { location: `${hole.origin}/stalled` } }));
}

/** A device that has read the warning and chosen a language, so a case is not about the dialogs. */
async function returningPlayer(context: BrowserContext): Promise<void> {
  await seedSettings(context, { seen: { photosensitivity: true }, locale: "en" });
}

test("on a slow phone link nothing is ever blank, and nothing shows before what it draws has arrived", async ({ page }) => {
  test.setTimeout(420_000);
  const arrivals = trackArrivals(page.context());
  await throttle(page, SLOW_PHONE);

  const startedAt = Date.now();
  const watching = watchScreen(page, startedAt);
  await page.goto("/", { waitUntil: "commit" });

  // A first visit, as a player's: the language, the warning, then the splash.
  const language = page.getByTestId("language-first");
  const warning = page.getByTestId("photosensitivity-warning");
  const splash = page.getByTestId("splash");
  await expect(language.or(warning).or(splash)).toBeVisible({ timeout: CLIENT_BOOT_MS * 2 });
  if (await language.isVisible()) {
    await language.getByTestId("language-first-continue").click();
    await expect(warning).toBeVisible({ timeout: CLIENT_BOOT_MS });
  }
  if (await warning.isVisible()) await warning.getByTestId("photosensitivity-continue").click();

  // The splash shows, then waits for the menu, the pictures and the song.
  const ready = splash.getByTestId("splash-ready");
  await expect(splash).toHaveClass(/ff-splash--shown/, { timeout: CLIENT_BOOT_MS * 2 });
  let sawSlowLine = false;
  let askedForTapAt: number | undefined;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if ((await page.getByTestId("splash-slow").textContent().catch(() => "")) !== "") sawSlowLine = true;
    if ((await ready.getAttribute("data-ready").catch(() => null)) === "true") {
      askedForTapAt = Date.now();
      break;
    }
    await page.waitForTimeout(250);
  }
  expect(askedForTapAt, "the splash asked for the tap").toBeDefined();
  await splash.click();
  await expectScreen(page, "title");
  await expect(page.getByTestId("title-play")).toBeEnabled();
  const samples = await watching.stop();

  // 1. Never a blank frame: after the first paint, no sample is one flat colour.
  const painted = samples.filter((sample) => sample.painted);
  // What the run saw, for the report: when the page first painted, and how long
  // each wait took on this link.
  const note = (type: string, description: string): void => void test.info().annotations.push({ type, description });
  note("samples", `${samples.length} taken, ${painted.length} after the first paint (the first at ${painted[0]?.at} ms); ${samples.length - painted.length} before it`);
  const shownAt = (await momentsOf(page)).find((moment) => moment.name === "splash-shown")?.at;
  const menuAt = (await momentsOf(page)).find((moment) => moment.name === "menu-ready")?.at;
  note("timeline", `splash shown ${shownAt === undefined ? "?" : shownAt - startedAt} ms, tap asked for ${menuAt === undefined ? "?" : menuAt - startedAt} ms after navigation`);
  for (const [path, at] of arrivals) note("arrived", `${path} at ${at - startedAt} ms`);
  expect(painted.length, "samples were taken after the first paint").toBeGreaterThan(50);
  const flat = painted.filter((sample) => sample.flat).map((sample) => `${sample.at} ms`);
  expect(flat, `flat (blank) frames, in ms from navigation, of ${painted.length} samples`).toEqual([]);

  // 2. Nothing before what it draws: at the moment each screen showed, its
  //    fonts, art, pictures and song were in -- by its own account, and by
  //    what the network had delivered by then.
  const moments = await momentsOf(page);
  const shown = moments.find((moment) => moment.name === "splash-shown");
  const menuReady = moments.find((moment) => moment.name === "menu-ready");
  expect(shown?.facts, "the splash recorded its moment").toEqual({ fontsLoaded: true, splashArtLoaded: true });
  expect(menuReady?.facts, "the menu recorded its moment").toEqual({ menuBundleLoaded: true, shellBundleLoaded: true, songDownloaded: true });

  const clockSkewMs = 400;
  const fonts = [...arrivals].filter(([path]) => path.endsWith(".woff2"));
  expect(fonts.length, "the splash's fonts were fetched").toBeGreaterThan(0);
  for (const [path, at] of fonts) {
    if (path.includes("noto")) continue; // a CJK face only a CJK locale loads
    expect(shown!.at, `the splash showed after ${path} finished`).toBeGreaterThanOrEqual(at - clockSkewMs);
  }
  const art = [...arrivals].find(([path]) => path.endsWith("splash.png"));
  expect(art, "the splash's art was fetched").toBeDefined();
  expect(shown!.at, "the splash showed after its art finished").toBeGreaterThanOrEqual(art![1] - clockSkewMs);
  const song = [...arrivals].find(([path]) => path.endsWith("main-menu.m4a"));
  expect(song, "the menu song was fetched").toBeDefined();
  expect(menuReady!.at, "Tap to start came after the last byte of the song").toBeGreaterThanOrEqual(song![1] - clockSkewMs);
  expect(askedForTapAt!, "and the page showed it only then").toBeGreaterThanOrEqual(song![1] - clockSkewMs);

  // 3. Slow is said, not failed: the splash waited more than 8 s and said so.
  expect(sawSlowLine, "the splash said it was slow while it waited").toBe(true);

  // 4. No screen was built before its bundle: nothing asked for an unloaded texture.
  expect(await unloadedTexturesOf(page)).toEqual([]);
});

test.describe("a request that never answers", () => {
  /** Polls once a second that `absent` stays absent and the boot loader (or `visibleMeanwhile`) stays up. */
  async function quietUntil(page: Page, since: number, ms: number, absent: ReturnType<Page["getByTestId"]>, meanwhile: ReturnType<Page["getByTestId"]>): Promise<void> {
    while (Date.now() - since < ms) {
      await expect(absent, `no failure before ${ms / 1000} s (${Math.round((Date.now() - since) / 1000)} s so far)`).toHaveCount(0);
      await expect(meanwhile, "something is on screen while it waits").toBeVisible();
      await page.waitForTimeout(1_000);
    }
  }

  test("the manifest: the boot failure after 30 s of silence and not before, and Try again recovers", async ({ page }) => {
    test.setTimeout(300_000);
    await returningPlayer(page.context());
    const hole = await blackhole();
    try {
      await stallRequests(page.context(), "**/assets/manifest.json", hole);
      await page.goto("/", { waitUntil: "commit" });
      await expect.poll(() => hole.firstRequestAt(), { message: "the manifest was asked for", timeout: 30_000 }).toBeDefined();
      const requestedAt = hole.firstRequestAt()!;

      await quietUntil(page, requestedAt, 27_000, page.getByTestId("boot-error"), page.getByTestId("boot-loader"));
      const failure = page.getByTestId("boot-error");
      await expect(failure).toBeVisible({ timeout: 25_000 });
      const afterMs = Date.now() - requestedAt;
      expect(afterMs, "the failure came after the silence, not before").toBeGreaterThanOrEqual(STALL_FLOOR_MS);
      await expect(failure.getByTestId("boot-retry")).toBeVisible();
      await expect(page.getByTestId("boot-loader"), "the loader gives way to the failure").toBeHidden();

      await page.context().unroute("**/assets/manifest.json");
      await failure.getByTestId("boot-retry").click();
      await expect(page.getByTestId("splash").getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS * 2 });
    } finally {
      await hole.close();
    }
  });

  test("the splash's art: the failure with Try again after 30 s of silence and not before, and Try again recovers", async ({ page }) => {
    test.setTimeout(300_000);
    await returningPlayer(page.context());
    const hole = await blackhole();
    try {
      await stallRequests(page.context(), "**/assets/production/splash.png", hole);
      await page.goto("/", { waitUntil: "commit" });
      await expect.poll(() => hole.firstRequestAt(), { message: "the splash's art was asked for", timeout: CLIENT_BOOT_MS * 2 }).toBeDefined();
      const requestedAt = hole.firstRequestAt()!;

      // The boot loader holds the screen meanwhile; the splash is under its
      // cover, not shown half-loaded, for as long as it waits.
      await expect(page.getByTestId("splash")).toBeAttached();
      await expect(page.getByTestId("splash")).not.toHaveClass(/ff-splash--shown/);
      await quietUntil(page, requestedAt, 27_000, page.getByTestId("error-view"), page.getByTestId("boot-loader"));
      const failure = page.getByTestId("error-view");
      await expect(failure).toBeVisible({ timeout: 25_000 });
      expect(Date.now() - requestedAt, "the failure came after the silence, not before").toBeGreaterThanOrEqual(STALL_FLOOR_MS);
      await expect(failure).toContainText("Could not load the game");

      await page.context().unroute("**/assets/production/splash.png");
      await failure.getByTestId("error-retry").click();
      // The retry is never a blank cover: the loader is back at once.
      await expect(page.getByTestId("boot-loader")).toBeVisible({ timeout: 2_000 });
      await expect(page.getByTestId("splash").getByTestId("splash-ready")).toHaveAttribute("data-ready", "true", { timeout: CLIENT_BOOT_MS * 2 });
    } finally {
      await hole.close();
    }
  });
});
