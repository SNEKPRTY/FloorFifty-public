/**
 * Stage seeds, for the owner's gate (stage seeds spec §6.1): the stage step
 * with its seed chip and another player's entered seed in the rows, the
 * editor open, and the settled reveal naming the seed, on a desktop and a
 * phone either way up. Writes to `evidence/stage-seeds/`, which git ignores;
 * nothing is compared.
 */
import { expect, test } from "./support/test";
import { evidenceDir } from "./support/evidence";
import { createRoom, expectNoOverlap, joinRoom, openClients, pressLockIn, readyOnly } from "./support/room-driver";

const SHOTS = evidenceDir("stage-seeds");

test("the seed chip, the editor and the reveal", async ({ browser }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(!["desktop", "mobile-portrait", "mobile-landscape"].includes(project), "a desktop and a phone either way up");
  const pages = await openClients(browser, 2);
  const [host, guest] = [pages[0]!, pages[1]!];
  try {
    const code = await createRoom(host, "Kite");
    await joinRoom(guest, code, "Sable");
    await readyOnly(pages);
    for (const page of pages) await expect(page.getByTestId("select-screen")).toHaveAttribute("data-step", "stage", { timeout: 15_000 });

    // Sable enters a seed, so Kite's rows show one.
    await guest.getByTestId("seed-chip").click();
    // The chip shows the room's answer: wait for Classic before asking for the editor.
    await expect(guest.getByTestId("seed-chip")).toHaveAttribute("data-choice", "classic");
    await guest.getByTestId("seed-chip").click();
    await guest.getByTestId("seed-text").fill("48213");
    await guest.getByTestId("seed-confirm").click();
    await expect(host.getByTestId("player-row").nth(1)).toContainText("#048213");

    await host.bringToFront();
    await expectNoOverlap(host, '[data-testid="seed-chip"]', '[data-testid="lock-in"]');
    await host.screenshot({ path: `${SHOTS}/${project}-1-stage-step.png` });

    await host.getByTestId("seed-chip").click();
    await expect(host.getByTestId("seed-chip")).toHaveAttribute("data-choice", "classic");
    await host.getByTestId("seed-chip").click();
    await expect(host.getByTestId("seed-editor")).toBeVisible();
    await host.waitForTimeout(400);
    // Every cell inside the viewport: six digits and the "#" on one line.
    const viewport = host.viewportSize()!;
    // Over the whole screen, not held inside the panel's glass (a backdrop-filter there contains a fixed dialog).
    const dialog = (await host.getByTestId("seed-editor").boundingBox())!;
    expect(Math.abs(dialog.x + dialog.width / 2 - viewport.width / 2), "the editor is centred on the screen").toBeLessThan(viewport.width * 0.1);
    for (const cell of await host.getByTestId("seed-digit").all()) {
      const box = (await cell.boundingBox())!;
      expect(box.x + box.width, "a digit cell runs off the right edge").toBeLessThanOrEqual(viewport.width);
    }
    await host.screenshot({ path: `${SHOTS}/${project}-2-editor.png` });
    await host.getByTestId("seed-random").click();
    await expect(host.getByTestId("seed-editor")).toHaveCount(0);

    for (const page of pages) await pressLockIn(page);
    await expect(host.getByTestId("roulette")).toHaveAttribute("data-settled", "true", { timeout: 10_000 });
    await host.waitForTimeout(900);
    await host.screenshot({ path: `${SHOTS}/${project}-3-reveal.png` });
  } finally {
    for (const page of pages) await page.context().close().catch(() => undefined);
  }
});
