/**
 * Stage seeds (stage seeds spec §6.1): a seed entered on the stage step is the
 * one the reveal names; left on Random, the reveal names a fresh one; and the
 * editor answers a keyboard as a pad's directions.
 */
import { expect, test, type Page } from "./support/test";
import { createRoom, openClients, pressLockIn, readyOnly } from "./support/room-driver";

/** One player in a private room, on the stage step. */
async function onStageStep(page: Page): Promise<void> {
  await createRoom(page, "Kite");
  await readyOnly([page]);
  await expect(page.getByTestId("select-screen"), "the stage step opens").toHaveAttribute("data-step", "stage", { timeout: 15_000 });
}

test.describe("stage seeds", () => {
  test("a seed entered on the stage step is the one the reveal names", async ({ browser }) => {
    const [page] = await openClients(browser, 1);
    try {
      await onStageStep(page!);
      const chip = page!.getByTestId("seed-chip");
      await expect(chip).toHaveAttribute("data-choice", "random");
      await chip.click();
      await expect(chip, "Random moves to Classic").toHaveAttribute("data-choice", "classic");
      await chip.click();
      await expect(page!.getByTestId("seed-editor")).toBeVisible();
      await page!.getByTestId("seed-text").fill("12345");
      await page!.getByTestId("seed-confirm").click();
      await expect(chip, "the room takes the entered seed").toHaveAttribute("data-choice", "12345");
      await pressLockIn(page!);
      // The number shows only on the chip the player set; the reveal draws none.
      await expect(page!.getByTestId("roulette")).toBeVisible({ timeout: 10_000 });
      await expect(page!.getByTestId("roulette-seed")).toHaveCount(0);
    } finally {
      await page!.context().close();
    }
  });

  test("left on Random, the reveal shows no seed number", async ({ browser }) => {
    const [page] = await openClients(browser, 1);
    try {
      await onStageStep(page!);
      await pressLockIn(page!);
      await expect(page!.getByTestId("roulette")).toBeVisible({ timeout: 10_000 });
      await expect(page!.getByTestId("roulette-seed")).toHaveCount(0);
    } finally {
      await page!.context().close();
    }
  });

  test("the editor takes the keyboard's arrows as a pad's directions", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a keyboard is a desktop's");
    const [page] = await openClients(browser, 1);
    try {
      await onStageStep(page!);
      const chip = page!.getByTestId("seed-chip");
      await chip.focus();
      await page!.keyboard.press("Enter");
      await expect(chip).toHaveAttribute("data-choice", "classic");
      await page!.keyboard.press("Enter");
      const first = page!.getByTestId("seed-digit").first();
      await expect(first).toBeFocused();
      await page!.keyboard.press("ArrowUp");
      await expect(first).toHaveText("1");
      await page!.keyboard.press("ArrowRight");
      await page!.keyboard.press("7");
      await expect(page!.getByTestId("seed-text")).toHaveValue("170000");
      await page!.getByTestId("seed-confirm").focus();
      await page!.keyboard.press("Enter");
      await expect(chip).toHaveAttribute("data-choice", "170000");
    } finally {
      await page!.context().close();
    }
  });
});
