/**
 * Images that say they are loading (async loaders spec), seen in a browser:
 * the stage step's stills are held at the network, so their frames must be
 * toned with the ring, then show the still once let through.
 *
 * Only the DOM's own image requests are held (`resourceType() === "image"`);
 * the canvas's texture loads go by, so the room and the select phase run as
 * they always do. Routing turns off the HTTP cache, so the DOM's request
 * reaches the route even after the texture load fetched the same file.
 */

import { expect, test, type Page, type Route } from "./support/test";
import { createRoom, joinRoom, openClients, readyOnly } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

test.beforeAll(async () => {
  await waitForServer();
});

// A query too: a failed image is retried on a URL of its own (`?retry=1`).
const STILLS = /\/assets\/production\/still-[^/]*-preview\.png(?:\?.*)?$/;

/** Holds every DOM image request for a stage still until `release`. */
async function holdStills(page: Page): Promise<{ release(): void }> {
  const held: Route[] = [];
  let released = false;
  await page.context().route(STILLS, async (route) => {
    if (route.request().resourceType() !== "image" || released) return route.continue();
    held.push(route);
  });
  return {
    release() {
      released = true;
      for (const route of held.splice(0)) void route.continue();
    },
  };
}

async function toStageStep(browser: import("@playwright/test").Browser, before: (page: Page) => Promise<void>): Promise<Page[]> {
  const pages = await openClients(browser, 2);
  await before(pages[0]!);
  const code = await createRoom(pages[0]!, "Alpha");
  await joinRoom(pages[1]!, code, "Bravo");
  await readyOnly(pages);
  await expect(pages[0]!.getByTestId("select-screen"), "the stage step opens").toHaveAttribute("data-step", "stage", { timeout: 15_000 });
  return pages;
}

test("a stage still loads behind a toned frame and the ring, then shows", async ({ browser }) => {
  test.slow();
  let release = (): void => {};
  const pages = await toStageStep(browser, async (page) => {
    ({ release } = await holdStills(page));
  });
  const a = pages[0]!;
  try {
    const frame = a.locator('.ff-async:has(img[src*="still-"])').first();
    await expect(frame).toHaveAttribute("data-load", "pending");
    await expect(frame.locator(".ff-async__ring"), "the ring joins after its beat").toBeVisible({ timeout: 2_000 });

    release();
    await expect(frame).toHaveAttribute("data-load", "loaded", { timeout: 10_000 });
    await expect(frame.locator(".ff-async__ring")).toHaveCount(0);
    await expect(frame.locator("img")).toHaveCSS("opacity", "1");

    // A panned slide's still is still panning: the keyframes survived the move under `:global`.
    const slide = a.getByTestId("stage-slide").filter({ has: frame });
    if ((await slide.count()) > 0 && (await slide.first().getAttribute("data-pan")) === "pan") {
      expect(await frame.locator("img").evaluate((img) => img.getAnimations().length)).toBeGreaterThan(0);
    }
  } finally {
    release();
    for (const page of pages) await page.context().close();
  }
});

test("a stage still that fails keeps its tone and stops the ring", async ({ browser }) => {
  test.slow();
  const pages = await toStageStep(browser, async (page) => {
    await page.context().route(STILLS, (route) => (route.request().resourceType() === "image" ? route.abort() : route.continue()));
  });
  const a = pages[0]!;
  try {
    const frame = a.locator('.ff-async:has(img[src*="still-"])').first();
    await expect(frame).toHaveAttribute("data-load", "failed", { timeout: 10_000 });
    await expect(frame.locator(".ff-async__ring")).toHaveCount(0);
  } finally {
    for (const page of pages) await page.context().close();
  }
});
