import { expect, test } from "./support/test";
import { driveRoom, holdRoomClocks, waitForServer } from "./support/server-fixture";
import {
  CLIENT_FOLLOWS_MS,
  chooseMode,
  createRoom,
  expectCanvasHasPixels,
  expectScreen,
  joinRoom,
  openClients,
  readyAll,
  RESULTS_TIMEOUT_MS,
} from "./support/room-driver";

/** What a page showing the room's change is waited for: a stall's length, not Playwright's 5 s (`CLIENT_FOLLOWS_MS`). */
const expectFollows = expect.configure({ timeout: CLIENT_FOLLOWS_MS });

test.beforeAll(async () => {
  await waitForServer();
});

test("four players can complete a one-lap room and receive the same winner", async ({
  browser,
}) => {
  test.slow();
  const players = await openClients(browser, 4);
  const code = await createRoom(players[0]!, "Kite");

  await Promise.all(players.slice(1).map((page, index) => joinRoom(page, code, `Ninja ${index + 2}`)));
  // The countdown is held (server `clock-hold.ts`) until every page shows the
  // race: on a slow machine four idle racers were out of a survival race
  // before the last page was looked at, and it found the results instead.
  await holdRoomClocks(code, ["countdown"]);
  await readyAll(players);

  for (const page of players) await expectScreen(page, "gameplay");
  await expectCanvasHasPixels(players[0]!);
  await holdRoomClocks(code, []);

  // Driven through the real simulation; the server decides the winner.
  const result = await driveRoom(code);
  expect(result.phase).toBe("finished");
  expect(result.winnerId).toBeTruthy();

  for (const page of players) await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);

  // The point of the test: every client shows the same server-issued result.
  const winners = await Promise.all(
    players.map((page) => page.getByTestId("winner").textContent()),
  );
  expect(new Set(winners).size).toBe(1);
  expect(winners[0]).toMatch(/wins$/);

  for (const page of players) await page.context().close();
});

test("a guest cannot change the lap count and the host can", async ({ browser }) => {
  const [host, guest] = await openClients(browser, 2);
  const code = await createRoom(host!, "Kite");
  await joinRoom(guest!, code, "Ninja 2");
  // Rooms open on Survival (catalog order, 2026-10-13); laps belong to the 20-floor race.
  await chooseMode(host!, "floors-20");

  await expectFollows(guest!.getByTestId("lap-3")).toBeDisabled();
  await expectFollows(host!.getByTestId("lap-3")).toBeEnabled();

  await host!.getByTestId("lap-3").click();
  await expectFollows(guest!.getByTestId("lap-3")).toHaveAttribute("data-selected", "true");

  await host!.context().close();
  await guest!.context().close();
});

test("a fifth player is refused and stays on the menu", async ({ browser }) => {
  test.slow();
  const players = await openClients(browser, 4);
  const code = await createRoom(players[0]!, "Kite");
  await Promise.all(
    players.slice(1).map((page, index) => joinRoom(page, code, `Ninja ${index + 2}`)),
  );

  const [fifth] = await openClients(browser, 1);
  await fifth!.getByTestId("name-input").fill("Fifth");
  await fifth!.getByTestId("code-input").fill(code);
  await fifth!.getByTestId("join-room").click();

  // The room already seats its maximum, said in the game's words.
  await expectFollows(fifth!.getByTestId("menu-status")).toContainText(/room is full/i);
  // The code is still typed, so the code row's button is Join room; the name
  // row's Find a race shows the player is back on the menu.
  await expectFollows(fifth!.getByTestId("find-race")).toBeVisible();

  for (const page of [...players, fifth!]) await page.context().close();
});

test("an unknown room code keeps the player on the menu", async ({ browser }) => {
  const [page] = await openClients(browser, 1);
  await page!.getByTestId("name-input").fill("Kite");
  await page!.getByTestId("code-input").fill("ZZZZZZ");
  await page!.getByTestId("join-room").click();

  await expectFollows(page!.getByTestId("menu-status")).not.toBeEmpty();
  await expectFollows(page!.getByTestId("find-race")).toBeVisible();
  await page!.context().close();
});
