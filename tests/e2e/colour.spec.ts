import { expect, test } from "./support/test";
import { createRoom, expectScreen, joinRoom, openClients, readyAll, RESULTS_TIMEOUT_MS } from "./support/room-driver";
import { driveRoom, waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

test("a guest takes orange, and both players see it in the room, the race and the results", async ({ browser }) => {
  test.slow();
  const [host, guest] = await openClients(browser, 2);
  const code = await createRoom(host!, "Kite");
  await joinRoom(guest!, code, "Sable");

  // The guest is seat 2, blue; they take orange on the Character page, beside the body.
  await guest!.getByTestId("seat-change").click();
  await guest!.locator('[data-testid="colour-swatch"][data-colour="gold"]').click();
  await expect(guest!.getByTestId("character-page")).toBeVisible();
  await guest!.getByTestId("character-back").click();
  for (const page of [host!, guest!]) {
    await expect(page.getByTestId("seat").nth(1)).toHaveAttribute("data-scarf", "gold");
  }

  await readyAll([host!, guest!]);
  for (const page of [host!, guest!]) await expectScreen(page, "gameplay");
  for (const page of [host!, guest!]) {
    await expect(page.locator('[data-testid="hud-row"][data-seat="1"] .ff-hud__dot')).toHaveAttribute("style", /--ff-player-gold/);
  }

  await driveRoom(code);
  for (const page of [host!, guest!]) await expectScreen(page, "game-end", RESULTS_TIMEOUT_MS);
  const portrait = host!.locator('[data-testid="result-row"]', { hasText: "Sable" }).getByTestId("result-portrait");
  await expect(portrait).toHaveAttribute("src", /gold/i);

  await host!.context().close();
  await guest!.context().close();
});
