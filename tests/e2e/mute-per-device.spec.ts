import { expect, test, type BrowserContext, type Page } from "./support/test";
import { CLIENT_FOLLOWS_MS, createRoom, joinRoom, openClient } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * Mute is the device's own setting (launch polish spec §3.1.2). The Owner
 * heard an iPad go quiet when a Mac in the same room was muted, and come back
 * when it was unmuted (2026-10-10). Nothing carries a mute between devices
 * outside Ruken: the settings live in each browser's own storage, and the
 * server never hears of them. This pins that, at the level a player hears:
 * the master gain each page's own Web Audio graph sends to its speakers.
 *
 * The new Ruken serves the game as a plain folder with no SDK, so the sound,
 * like every other setting, is the browser's own storage inside it too
 * (`ruken-frame.spec.ts` pins that, in the sandboxed frame).
 */

test.beforeAll(async () => {
  await waitForServer();
});

/**
 * Remembers each real AudioContext's master, the first gain node the graph
 * makes (`AudioGraph.buildIfNeeded`), so the test can read the level that
 * reaches the speakers rather than the setting that asks for it.
 */
async function watchMaster(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const Real = window.AudioContext;
    const masters: { context: AudioContext; master?: GainNode }[] = [];
    class Watched extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        const entry: { context: AudioContext; master?: GainNode } = { context: this };
        masters.push(entry);
        const createGain = this.createGain.bind(this);
        this.createGain = () => {
          const node = createGain();
          entry.master ??= node;
          return node;
        };
      }
    }
    window.AudioContext = Watched;
    (window as unknown as { __ffMaster: () => unknown }).__ffMaster = () =>
      masters.map(({ context, master }) => ({ state: context.state, gain: master?.gain.value }));
  });
}

type MasterReading = { state: AudioContextState; gain: number | undefined }[];
const masterOf = (page: Page): Promise<MasterReading> =>
  page.evaluate(() => (window as unknown as { __ffMaster: () => MasterReading }).__ffMaster());
const LIVE: MasterReading = [{ state: "running", gain: 1 }];

test("muting one device leaves another device in the same room sounding", async ({ browser }) => {
  test.slow();
  // Two devices: two contexts, so two browsers' worth of storage, each
  // watched before its first script runs.
  const pages: Page[] = [];
  for (let device = 0; device < 2; device += 1) {
    const context = await browser.newContext();
    await watchMaster(context);
    const page = await context.newPage();
    await openClient(page);
    pages.push(page);
  }
  const [mac, ipad] = pages as [Page, Page];
  try {
    const code = await createRoom(mac, "Mac");
    await joinRoom(ipad, code, "iPad");

    // Both pages took the splash's tap, so both graphs run at full level.
    await expect.poll(() => masterOf(mac), { timeout: CLIENT_FOLLOWS_MS }).toEqual(LIVE);
    await expect.poll(() => masterOf(ipad), { timeout: CLIENT_FOLLOWS_MS }).toEqual(LIVE);

    await mac.getByTestId("corner-mute").click();
    await expect(mac.getByTestId("corner-mute")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await masterOf(mac))[0]?.gain, { timeout: CLIENT_FOLLOWS_MS }).toBeLessThan(0.01);

    // The other device neither stores the mute nor hears it, however long it waits.
    await ipad.waitForTimeout(2_000);
    expect(await masterOf(ipad)).toEqual(LIVE);
    await expect(ipad.getByTestId("corner-mute")).toHaveAttribute("aria-pressed", "false");
  } finally {
    for (const page of pages) await page.context().close();
  }
});
