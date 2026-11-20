/**
 * Visual Overhaul #2's stage.
 *
 * Every background layer is refracted: the sky plate in its bounded target and
 * the city with its own soft refraction, blur included -- the user asked for
 * the blur back after trying a crisp city (spec §2.9, as amended). The capture
 * runs with the inspection-only `?lcd=off`, so it shows the scenery under the
 * panel.
 */

import { expect, test } from "./support/test";
import { waitForServer } from "./support/server-fixture";
import { readInspection } from "./support/inspection";
import {
  createRoom,
  expectScreen,
  openClient,
  readyAll,
} from "./support/room-driver";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await waitForServer();
});

test("every background layer is refracted, the city included", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop project only");
  test.slow();

  // 1536 wide fits the 960-unit field at 1.6, and a stationary camera zooms
  // by 1.25: two device pixels per logical unit, an integer scale.
  const context = await browser.newContext({
    viewport: { width: 1536, height: 864 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await openClient(page, "/?refraction=high&lcd=off");
    await createRoom(page, "Kite");
    await readyAll([page]);
    await expectScreen(page, "gameplay", 30_000);

    const inspection = await readInspection(page);
    expect(inspection.refraction).toBe("sky+city");
    expect(inspection.citySampling).toBe("nearest");

    // The camera eases to its stationary zoom; the HUD is DOM over the canvas.
    await page.waitForTimeout(2_000);
    await page.getByTestId("overlay").evaluate((node) => {
      (node as HTMLElement).style.visibility = "hidden";
    });
    await page.waitForTimeout(200);
    const shot = await page.locator("#app > canvas").screenshot();
    await testInfo.attach("city", { body: shot, contentType: "image/png" });

    // The lower half is the city; the letterbox bar covers the bottom tenth.
    // The edge-sharpness check is retired: the user asked for the background
    // layers blurred again (spec §2.9, as amended), so the city is refracted
    // with the sky's soft optics on purpose. The capture stays as evidence.
  } finally {
    await context.close();
  }
});
