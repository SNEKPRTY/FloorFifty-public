import { expect, test } from "./support/test";
import { expectScreen, openTitle } from "./support/room-driver";
import { waitForServer } from "./support/server-fixture";

/**
 * A phone turned sideways plays fullscreen (`landscape-gate.ts`): the cover
 * comes up over the title, one tap goes fullscreen and lifts it, and leaving
 * fullscreen brings it back. The client skips the gate under automation, so
 * this spec turns `navigator.webdriver` off to see it.
 */

test.beforeAll(async () => {
  await waitForServer();
});

test("a sideways phone is covered until it goes fullscreen", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  await openTitle(page);
  await expect(page.getByTestId("landscape-gate")).toHaveCount(0);

  await page.setViewportSize({ width: 844, height: 390 });
  const gate = page.getByTestId("landscape-gate");
  await expect(gate).toHaveAttribute("data-gate", "fullscreen");
  await page.screenshot({ path: "evidence/landscape-gate/cover.png" });

  await page.getByTestId("landscape-gate-fullscreen").click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await expect(gate).toHaveCount(0);
  await expectScreen(page, "title");

  await page.evaluate(() => document.exitFullscreen());
  await expect(gate).toHaveAttribute("data-gate", "fullscreen");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(gate).toHaveCount(0);
  await context.close();
});

for (const [name, size] of [
  ["iPhone SE", { width: 667, height: 375 }],
  ["iPhone 15 Pro Max", { width: 932, height: 430 }],
] as const) {
  test(`the cover's words are whole on the ${name} sideways`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: size.height, height: size.width },
      hasTouch: true,
      isMobile: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
    const page = await context.newPage();
    await openTitle(page);
    await page.setViewportSize(size);
    const gate = page.getByTestId("landscape-gate");
    await expect(gate).toHaveAttribute("data-gate", "rotate-or-install");
    const panel = gate.getByRole("dialog");
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    // Nothing is cut: the panel does not scroll or clip its own words.
    const clipped = await panel.evaluate((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
    await expect(gate.locator("ol > li")).toHaveCount(3);
    await page.screenshot({ path: `evidence/landscape-gate/ios-${size.width}x${size.height}.png` });
    await context.close();
  });
}
