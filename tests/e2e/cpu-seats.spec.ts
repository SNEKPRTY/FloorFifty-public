/**
 * CPU seats in the browser (CPU players spec §7.3): the host's taps, quick
 * match's Race CPUs to the results, and the owner's rule that a CPU changes
 * no layout, at every reference size.
 */
import { expect, test, type Page } from "./support/test";
import { LOCALE_TAGS } from "../../apps/client/src/features/i18n/locales";
import { driveRoom, waitForServer } from "./support/server-fixture";
import { CLIENT_FOLLOWS_MS, SCREEN_SETTLE_MS, createRoom, expectScreen, findRace, joinRoom, openClient, openClients, passSelect, RESULTS_TIMEOUT_MS, seedSettings } from "./support/room-driver";
import { SWEEP } from "./support/layout";

// Public rooms are shared by whoever finds a race, so these run one at a time.
test.describe.configure({ mode: "serial" });

/** What a page showing the room's change is waited for: a stall's length, not Playwright's 5 s (`CLIENT_FOLLOWS_MS`). */
const expectFollows = expect.configure({ timeout: CLIENT_FOLLOWS_MS });

test.beforeAll(async () => {
  await waitForServer();
});

async function leaveAndClose(...pages: Page[]): Promise<void> {
  for (const page of pages) {
    if ((await page.getByTestId("leave-room").count()) > 0) {
      await page.getByTestId("leave-room").click();
      await expectFollows(page.getByTestId("name-input")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
    }
    await page.context().close();
  }
}

test("the host taps an open seat for a CPU, and taps the CPU to free it", async ({ browser }) => {
  const [host, guest] = await openClients(browser, 2);
  const code = await createRoom(host!, "Kite");
  await joinRoom(guest!, code, "Wren");

  await expectFollows(guest!.getByTestId("seat-add-cpu")).toHaveCount(0);
  await host!.getByTestId("seat-add-cpu").last().click();

  // Kite is scarlet, Wren cyan: the CPU takes the next cell in gold or violet,
  // named for that colour's personality.
  for (const page of [host!, guest!]) {
    const third = page.getByTestId("seat").nth(2);
    await expectFollows(third).toHaveAttribute("data-cpu", "true");
    await expectFollows(third.getByTestId("seat-name")).toHaveText(/^(Sunny|Moth)$/);
    await expectFollows(third.getByTestId("seat-status")).toHaveText("CPU");
  }

  await host!.getByTestId("seat-remove-cpu").click();
  await expectFollows(guest!.getByTestId("seat").nth(2)).not.toHaveAttribute("data-cpu", "true");
  await leaveAndClose(host!, guest!);
});

test("a lone quick-match racer races CPUs to the results", async ({ browser }) => {
  test.slow();
  const [page] = await openClients(browser, 1);
  const code = await findRace(page!, "Kite");
  await expectFollows(page!.getByTestId("ready-toggle")).toHaveText("Race CPUs");
  await page!.getByTestId("ready-toggle").click();
  await expectFollows(page!.getByTestId("select-screen")).toBeVisible({ timeout: SCREEN_SETTLE_MS });
  await passSelect([page!]);
  await expectScreen(page!, "gameplay");
  const outcome = await driveRoom(code, { ticks: 60 * 240 });
  expect(outcome.phase).toBe("finished");
  expect(outcome.progress).toHaveLength(4);
  await expectScreen(page!, "game-end", RESULTS_TIMEOUT_MS);
  await expectFollows(page!.getByTestId("result-row")).toHaveCount(4);
  await leaveAndClose(page!);
});

/** Every box a CPU could move: the four cells, the settings and the buttons. */
async function boxes(page: Page) {
  const ids = ["race-options", "race-options-status", "ready-toggle", "leave-room"];
  const cells = await page.getByTestId("seat").evaluateAll((seats) => seats.map((seat) => seat.getBoundingClientRect().toJSON() as DOMRect));
  const rest = await Promise.all(ids.map(async (id) => (await page.getByTestId(id).boundingBox()) ?? undefined));
  return { cells, rest };
}

/** Measured only at rest: a seat's arrival motion must not be mistaken for a layout change. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
}

async function expectLayoutUnmoved(page: Page, where: string): Promise<void> {
  await settled(page);
  const before = await boxes(page);
  await page.getByTestId("seat-add-cpu").first().click();
  await expectFollows(page.locator('[data-testid="seat"][data-cpu="true"]')).toHaveCount(1);
  await settled(page);
  expect(await boxes(page), `${where}: adding a CPU moved something`).toEqual(before);
  await page.getByTestId("seat-remove-cpu").click();
  await expectFollows(page.locator('[data-testid="seat"][data-cpu="true"]')).toHaveCount(0);
  await settled(page);
  expect(await boxes(page), `${where}: removing a CPU moved something`).toEqual(before);
}

// English at every reference size; each other language at a phone held
// either way and a desktop, as the languages suite samples them.
const PLACES = [
  ...SWEEP.map((sweep) => ({ sweep, locale: "en" as const })),
  ...LOCALE_TAGS.filter((locale) => locale !== "en").flatMap((locale) =>
    SWEEP.filter(({ width, height }) => (width === 390 && height === 844) || (width === 1280 && height === 720)).map(
      (sweep) => ({ sweep, locale }),
    ),
  ),
];

/** The seat cells alone, at rest. */
async function cellBoxes(page: Page) {
  await settled(page);
  return page.getByTestId("seat").evaluateAll((seats) => seats.map((seat) => seat.getBoundingClientRect().toJSON() as DOMRect));
}

for (const { sweep, locale } of PLACES) {
  test(`a CPU moves nothing in the ready room: ${locale} at ${sweep.width}x${sweep.height}`, async ({ browser }) => {
    const open = async () => {
      const context = await browser.newContext({
        viewport: { width: sweep.width, height: sweep.height },
        hasTouch: sweep.touch,
        isMobile: sweep.touch && sweep.factor !== "desktop",
        reducedMotion: "reduce",
      });
      await seedSettings(context, { input: { touchMode: "buttons" }, locale });
      const page = await context.newPage();
      await openClient(page);
      return page;
    };
    const where = `${locale} ${sweep.width}x${sweep.height}`;
    const host = await open();
    const code = await createRoom(host, "Kite");
    const guest = await open();
    await joinRoom(guest, code, "Wren");
    // The guest's open seats are today's: no button, no "+ CPU". The host's
    // must be exactly that size. Sizes, not positions: each viewer's own seat
    // carries its own badges, which moves the rows below it differently.
    await expectFollows(host.getByTestId("seat-add-cpu")).toHaveCount(2);
    const openSizes = async (page: Page) =>
      (await cellBoxes(page)).slice(2).map(({ width, height }) => ({ width, height }));
    expect(await openSizes(host), `${where}: the host's + CPU seats differ from a guest's open seats`).toEqual(await openSizes(guest));
    await expectLayoutUnmoved(host, where);
    await leaveAndClose(guest, host);
  });
}
