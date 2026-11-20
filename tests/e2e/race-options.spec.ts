/**
 * The race options in the browser (race-options spec §3.4, survival spec §5,
 * §7): the host chooses the floors and Survival's clock and a guest sees
 * both, and a Survival race driven to its end shows each racer's result.
 */

import { expect, test } from "./support/test";
import { CLIENT_FOLLOWS_MS, chooseMode, createRoom, finishRace, joinRoom, openClients } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/** What a page showing the room's change is waited for: a stall's length, not Playwright's 5 s (`CLIENT_FOLLOWS_MS`). */
const expectFollows = expect.configure({ timeout: CLIENT_FOLLOWS_MS });

test.beforeAll(async () => {
  await waitForServer();
});

test.describe("the Floors row (race-options spec §3.4)", () => {
  // A room opens on Survival, the first mode in the catalog (2026-10-13).
  test("a room opens on Survival; the host picks 20, then 50, and the guest sees each", async ({ browser }) => {
    const [host, guest] = await openClients(browser, 2);
    const code = await createRoom(host!, "Alpha");
    await joinRoom(guest!, code, "Bravo");
    await expectFollows(guest!.getByTestId("mode-infinite")).toHaveAttribute("aria-checked", "true");
    await expectFollows(guest!.getByTestId("mode-floors-50")).toBeDisabled();
    await expectFollows(guest!.getByTestId("lap-chooser")).toHaveCount(0);
    await chooseMode(host!, "floors-20");
    await expectFollows(guest!.getByTestId("mode-floors-20")).toHaveAttribute("aria-checked", "true");
    await expectFollows(guest!.getByTestId("lap-chooser")).toBeVisible();
    await chooseMode(host!, "floors-50");
    await expectFollows(guest!.getByTestId("mode-floors-50")).toHaveAttribute("aria-checked", "true");
    await expectFollows(guest!.getByTestId("lap-chooser")).toHaveCount(0);
  });
});

test.describe("Survival's clock (survival spec §5)", () => {
  test("a room opens on Survival at 3:00; the host picks 1:00, and the guest sees it", async ({ browser }) => {
    const [host, guest] = await openClients(browser, 2);
    const code = await createRoom(host!, "Alpha");
    await joinRoom(guest!, code, "Bravo");
    await expectFollows(guest!.getByTestId("clock-chooser")).toBeVisible();
    await expectFollows(guest!.getByTestId("clock-180")).toHaveAttribute("aria-checked", "true");
    await host!.getByTestId("clock-60").click();
    await expectFollows(guest!.getByTestId("clock-60")).toHaveAttribute("aria-checked", "true");
    await expectFollows(guest!.getByTestId("clock-60")).toBeDisabled();
    await expectFollows(guest!.getByTestId("mode-infinite").locator("svg.ff-icon")).toBeVisible();
    // A finite race has no clock.
    await chooseMode(host!, "floors-20");
    await expectFollows(guest!.getByTestId("clock-chooser")).toHaveCount(0);
  });
});

test.describe("a Survival race (survival spec §4, §7)", () => {
  test("driven to its end, shows each racer's result and the mode", async ({ browser }) => {
    test.setTimeout(240_000);
    const { pages } = await finishRace(browser, { modeId: "infinite" });
    for (const page of pages) {
      await expectFollows(page.getByTestId("results-mode")).toHaveText("Survival");
      await expectFollows(page.getByTestId("result-best").first()).toHaveText(/^Floor \d+/);
    }
  });
});
