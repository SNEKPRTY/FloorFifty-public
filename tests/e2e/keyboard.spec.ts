import { expect, test, type Page } from "./support/test";
import { expectScreen, openTitle } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * The game with only a keyboard: Tab, Shift+Tab, Enter and Escape.
 */

test.beforeAll(async () => {
  await waitForServer();
});

/** The focused control's test id, and whether its whole box is inside the window. */
async function focusedInView(page: Page): Promise<{ id: string | null; inView: boolean }> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const box = active?.getBoundingClientRect();
    return {
      id: active?.dataset["testid"] ?? null,
      inView: box !== undefined && box.top >= 0 && box.left >= 0 && box.bottom <= innerHeight && box.right <= innerWidth,
    };
  });
}

test("Tab down a long dialog keeps the focused control on screen", async ({ page }) => {
  await openTitle(page);
  await page.getByTestId("title-settings").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("settings-modal");
  await expect(dialog).toBeVisible();
  // Every control of the Settings tab, past the bottom of the list and round to the top.
  const stops = await dialog.evaluate((node) => node.querySelectorAll("button, input, [tabindex='0']").length);
  for (let step = 0; step < stops + 2; step += 1) {
    await page.keyboard.press("Tab");
    await expect.poll(() => focusedInView(page), { message: `Tab ${step + 1}: the focused control can be seen`, timeout: 2_000 }).toMatchObject({ inView: true });
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectScreen(page, "title");
});

test("the first Tab on a new screen goes to its green button, not Back or Mute", async ({ page }) => {
  await openTitle(page);
  await page.keyboard.press("Tab");
  await expect.poll(() => focusedInView(page)).toMatchObject({ id: "title-play", inView: true });
  await page.keyboard.press("Enter");
  await expectScreen(page, "lobby");
  await page.keyboard.press("Tab");
  await expect.poll(() => focusedInView(page)).toMatchObject({ id: "find-race", inView: true });
});
