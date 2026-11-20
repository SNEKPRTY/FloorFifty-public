import { expect, test, type Page } from "./support/test";
import { waitForServer } from "./support/server-fixture";
import { createRoom, findRace, openClient, openClients, seedSettings } from "./support/room-driver";
import { expectControlsFit, expectNoDocumentScroll, expectReachable, expectRowsWhole, SWEEP } from "./support/layout";

// One server, and a public room is shared by whoever finds a race, so these
// run one after another rather than meeting each other's rooms.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await waitForServer();
});

const seated = (page: Page) => page.locator('[data-testid="seat"][data-ready]');

/**
 * Leaves with the real button, then closes the context. Closing a context
 * drops the socket, which holds the seat as a ghost for thirty seconds, and a
 * public room still in the lobby would then be offered to the next test.
 */
async function leaveAndClose(...pages: Page[]): Promise<void> {
  for (const page of pages) {
    if ((await page.getByTestId("leave-room").count()) > 0) {
      await page.getByTestId("leave-room").click();
      await expect(page.getByTestId("name-input")).toBeVisible({ timeout: 15_000 });
    }
    await page.context().close();
  }
}

test("two devices that are not in each other's room meet with Find a race", async ({ browser }) => {
  const [first, second] = await openClients(browser, 2);
  const code = await findRace(first!, "Kite");
  expect(await findRace(second!, "Sable")).toBe(code);

  await expect(seated(first!)).toHaveCount(2);
  await expect(seated(second!)).toHaveCount(2);
  await expect(first!.getByTestId("quick-match-clock")).toContainText("Race starts in");

  await leaveAndClose(first!, second!);
});

test("a lone racer sees the search, and can race CPUs without waiting for it", async ({ browser }) => {
  const [page] = await openClients(browser, 1);
  await findRace(page!, "Kite");

  await expect(page!.getByTestId("quick-match-clock")).toContainText("Looking for racers…");
  await expect(page!.getByTestId("ready-toggle")).toHaveText("Race CPUs");
  await page!.getByTestId("ready-toggle").click();
  await expect(page!.getByTestId("select-screen")).toBeVisible({ timeout: 5_000 });

  await leaveAndClose(page!);
});

test("a room opened with Create room is never matched", async ({ browser }) => {
  const [host, stranger] = await openClients(browser, 2);
  const code = await createRoom(host!, "Kite");
  expect(await findRace(stranger!, "Sable")).not.toBe(code);

  await expect(seated(host!)).toHaveCount(1);
  await leaveAndClose(host!, stranger!);
});

test("the start clock carries racers who never pressed Ready into select", async ({ browser }) => {
  test.slow();
  const [first, second] = await openClients(browser, 2);
  await findRace(first!, "Kite");
  await findRace(second!, "Sable");

  // Thirty seconds, then the room makes everyone ready. Nobody presses Ready.
  await expect(first!.getByTestId("select-screen")).toBeVisible({ timeout: 40_000 });
  await expect(second!.getByTestId("select-screen")).toBeVisible({ timeout: 5_000 });

  await leaveAndClose(first!, second!);
});

// The ready room's Ready button reads "Race CPUs" while a lone racer searches,
// which is wider than "Ready". It must still fit beside Leave room on a phone
// held either way, a tablet and a desktop, without the page scrolling.
const FIT = SWEEP.filter(
  ({ width, height }) =>
    (width === 390 && height === 844) ||
    (width === 844 && height === 390) ||
    (width === 820 && height === 1180) ||
    (width === 1280 && height === 720),
);

for (const sweep of FIT) {
  test(`a lone racer's ready room fits at ${sweep.width}x${sweep.height}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: sweep.width, height: sweep.height },
      hasTouch: sweep.touch,
      isMobile: sweep.touch && sweep.factor !== "desktop",
      reducedMotion: "reduce",
    });
    await seedSettings(context, { input: { touchMode: "buttons" } });
    const page = await context.newPage();
    await openClient(page);
    await findRace(page, "Kite");

    await expect(page.getByTestId("ready-toggle")).toHaveText("Race CPUs");
    // The action bar stays on one row: a wider label must not push Leave room
    // onto a second row of a column that has no height to spare.
    const readyBox = await page.getByTestId("ready-toggle").boundingBox();
    const leaveBox = await page.getByTestId("leave-room").boundingBox();
    expect
      .soft(
        Math.abs(readyBox!.y - leaveBox!.y),
        `Ready ${JSON.stringify(readyBox)} and Leave room ${JSON.stringify(leaveBox)} are on different rows`,
      )
      .toBeLessThanOrEqual(2);
    for (const action of ["ready-toggle", "leave-room"]) await expectReachable(page, action);
    await expectControlsFit(page, sweep.touch ? 44 : 0);
    await expectRowsWhole(page);
    await expectNoDocumentScroll(page);

    await leaveAndClose(page);
  });
}
