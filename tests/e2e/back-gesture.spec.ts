import { expect, test } from "./support/test";
import { enterLobby, expectScreen, openTitle } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * The browser's back -- Android's edge swipe, a mouse's back button -- is the
 * game's Back, and leaves the site only from the bare title.
 */

test.beforeAll(async () => {
  await waitForServer();
});

test("back closes the Character page and stays on the title", async ({ page }) => {
  await openTitle(page);
  const url = page.url();
  await page.getByTestId("title-character").click();
  await expect(page.getByTestId("character-page")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("character-page")).toHaveCount(0);
  await expectScreen(page, "title");
  expect(page.url()).toBe(url);

  // Armed again: a second back out of a second visit still closes it.
  await page.getByTestId("title-character").click();
  await expect(page.getByTestId("character-page")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("character-page")).toHaveCount(0);
  await expectScreen(page, "title");
});

test("back from the lobby returns to the title", async ({ page }) => {
  await openTitle(page);
  await enterLobby(page);
  await page.goBack();
  await expectScreen(page, "title");
});

test("back from the bare title leaves the site", async ({ page }) => {
  await page.goto("about:blank");
  await openTitle(page);
  await page.goBack();
  await expect.poll(() => page.url()).toBe("about:blank");
});
