/**
 * A dropped image request is not a lost image. A phone on Wi-Fi drops the odd
 * request; a portrait whose one request failed must try again and show, not
 * sit as an empty toned square until its screen is rebuilt.
 *
 * The portrait test fails only the DOM's own image requests
 * (`resourceType() === "image"`); the sheet test only the canvas's texture
 * fetches.
 */

import { expect, test } from "./support/test";
import { enterLobby, openTitle } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

const PORTRAITS = "**/assets/production/portrait-*.png";

test("a portrait whose first request drops tries again and shows", async ({ page }) => {
  const dropped = new Set<string>();
  await page.context().route(PORTRAITS, (route) => {
    const url = route.request().url();
    if (route.request().resourceType() !== "image" || dropped.has(url)) return route.continue();
    dropped.add(url);
    return route.abort("connectionreset");
  });
  await openTitle(page);
  const frame = page.getByTestId("title-character").locator(".ff-async");
  await expect(frame).toHaveAttribute("data-load", "loaded", { timeout: 10_000 });
  await expect(frame.locator("img")).toHaveCSS("opacity", "1");
  expect(dropped.size, "a request was dropped").toBeGreaterThan(0);
});

test("a character sheet whose first texture fetch drops is fetched again, not given up on", async ({ page }) => {
  const SHEET = "**/assets/production/frog-violet.png";
  let fetches = 0;
  await page.context().route(SHEET, (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue();
    fetches += 1;
    return fetches === 1 ? route.abort("connectionreset") : route.continue();
  });
  // The ready room loads every character's sheet behind it (the shell bundle).
  await openTitle(page);
  await enterLobby(page);
  await expect.poll(() => fetches, { message: "the dropped sheet is asked for again", timeout: 15_000 }).toBeGreaterThan(1);
});
